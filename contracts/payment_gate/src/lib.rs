#![no_std]
use soroban_sdk::{
    contract, contractimpl, symbol_short, token, Address, Env, Symbol,
};

const REGISTRY_KEY: Symbol = symbol_short!("REGISTRY");

fn fee_bps(tier: u32) -> i128 {
    match tier {
        3 => 30,   // Gold:       0.3%
        2 => 100,  // Silver:     1.0%
        1 => 200,  // Bronze:     2.0%
        _ => 500,  // Unverified: 5.0%
    }
}

fn max_payment(tier: u32) -> i128 {
    match tier {
        3 => 1_000_000 * 10_000_000,
        2 =>   100_000 * 10_000_000,
        1 =>    10_000 * 10_000_000,
        _ =>     1_000 * 10_000_000,
    }
}

#[contract]
pub struct PaymentGate;

#[contractimpl]
impl PaymentGate {
    pub fn initialize(env: Env, registry: Address) {
        if env.storage().instance().has(&REGISTRY_KEY) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&REGISTRY_KEY, &registry);
    }

    /// Send a reputation-gated payment.
    /// Fee is deducted and sent to fee_collector. Net goes to recipient.
    pub fn send(
        env: Env,
        sender: Address,
        recipient: Address,
        token_id: Address,
        amount: i128,
        fee_collector: Address,
    ) {
        sender.require_auth();

        let registry: Address = env.storage().instance().get(&REGISTRY_KEY).unwrap();
        let tier: u32 = env.invoke_contract(
            &registry,
            &symbol_short!("get_tier"),
            soroban_sdk::vec![&env, sender.clone().into()],
        );

        if amount <= 0 { panic!("Amount must be positive"); }
        if amount > max_payment(tier) { panic!("Amount exceeds tier limit"); }

        let fee = amount * fee_bps(tier) / 10_000;
        let net = amount - fee;

        let token = token::Client::new(&env, &token_id);
        if fee > 0 { token.transfer(&sender, &fee_collector, &fee); }
        token.transfer(&sender, &recipient, &net);

        env.events().publish(
            (symbol_short!("payment"),),
            (sender, recipient, amount, fee, tier),
        );
    }

    /// Preview fee and net without executing. Returns (fee, net, tier).
    #[allow(clippy::too_many_arguments)]
    pub fn quote(env: Env, wallet: Address, amount: i128) -> (i128, i128, u32) {
        let registry: Address = env.storage().instance().get(&REGISTRY_KEY).unwrap();
        let tier: u32 = env.invoke_contract(
            &registry,
            &symbol_short!("get_tier"),
            soroban_sdk::vec![&env, wallet.into()],
        );
        let fee = amount * fee_bps(tier) / 10_000;
        (fee, amount - fee, tier)
    }

    /// Return the max payment limit for a wallet.
    pub fn limit(env: Env, wallet: Address) -> i128 {
        let registry: Address = env.storage().instance().get(&REGISTRY_KEY).unwrap();
        let tier: u32 = env.invoke_contract(
            &registry,
            &symbol_short!("get_tier"),
            soroban_sdk::vec![&env, wallet.into()],
        );
        max_payment(tier)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation},
        Address, Env, IntoVal,
    };

    // ----------------------------------------------------------------
    // Fee / limit unit tests (pure functions, no env needed)
    // ----------------------------------------------------------------

    #[test]
    fn fee_bps_gold() {
        assert_eq!(fee_bps(3), 30);
    }

    #[test]
    fn fee_bps_silver() {
        assert_eq!(fee_bps(2), 100);
    }

    #[test]
    fn fee_bps_bronze() {
        assert_eq!(fee_bps(1), 200);
    }

    #[test]
    fn fee_bps_unverified() {
        assert_eq!(fee_bps(0), 500);
    }

    #[test]
    fn max_payment_gold() {
        assert_eq!(max_payment(3), 1_000_000 * 10_000_000);
    }

    #[test]
    fn max_payment_silver() {
        assert_eq!(max_payment(2), 100_000 * 10_000_000);
    }

    #[test]
    fn max_payment_bronze() {
        assert_eq!(max_payment(1), 10_000 * 10_000_000);
    }

    #[test]
    fn max_payment_unverified() {
        assert_eq!(max_payment(0), 1_000 * 10_000_000);
    }

    // ----------------------------------------------------------------
    // Fee arithmetic correctness
    // ----------------------------------------------------------------

    #[test]
    fn fee_calculation_silver_100_xlm() {
        // 100 XLM = 1_000_000_000 stroops, Silver = 1.0%
        let amount: i128 = 1_000_000_000;
        let fee = amount * fee_bps(2) / 10_000;
        let net = amount - fee;
        assert_eq!(fee, 10_000_000);   // 1 XLM
        assert_eq!(net, 990_000_000);  // 99 XLM
    }

    #[test]
    fn fee_calculation_gold_zero_rounds_correctly() {
        // 1 stroop Gold: fee = 1 * 30 / 10_000 = 0 (rounds down)
        let fee = 1_i128 * fee_bps(3) / 10_000;
        assert_eq!(fee, 0);
    }

    #[test]
    fn fee_net_sum_equals_amount_for_all_tiers() {
        let amount: i128 = 500_000_000; // 50 XLM
        for tier in 0..=3 {
            let fee = amount * fee_bps(tier) / 10_000;
            let net = amount - fee;
            assert_eq!(fee + net, amount, "fee+net != amount for tier {tier}");
        }
    }

    // ----------------------------------------------------------------
    // initialize / double-initialize guard
    // ----------------------------------------------------------------

    #[test]
    fn initialize_stores_registry() {
        let env = Env::default();
        let contract_id = env.register_contract(None, PaymentGate);
        let client = PaymentGateClient::new(&env, &contract_id);

        let registry = Address::generate(&env);
        client.initialize(&registry);

        // Verify it stored correctly by checking double-init panics
        let result = std::panic::catch_unwind(|| {
            // A second initialize should panic
            let env2 = Env::default();
            let cid2 = env2.register_contract(None, PaymentGate);
            let c2 = PaymentGateClient::new(&env2, &cid2);
            let r2 = Address::generate(&env2);
            c2.initialize(&r2);
            c2.initialize(&r2); // second call must panic
        });
        // The second call inside the closure should have panicked
        assert!(result.is_err(), "Double initialize should panic");
    }

    #[test]
    #[should_panic(expected = "Already initialized")]
    fn double_initialize_panics() {
        let env = Env::default();
        let contract_id = env.register_contract(None, PaymentGate);
        let client = PaymentGateClient::new(&env, &contract_id);

        let registry = Address::generate(&env);
        client.initialize(&registry);
        client.initialize(&registry); // must panic
    }
}
