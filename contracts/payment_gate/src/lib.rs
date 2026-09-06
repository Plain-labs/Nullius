#![no_std]
use soroban_sdk::{
    contract, contractevent, contractimpl, symbol_short, token, Address, Env, IntoVal, Symbol,
};

const REGISTRY_KEY: Symbol = symbol_short!("REGISTRY");

fn fee_bps(tier: u32) -> i128 {
    match tier {
        3 => 30,  // Gold:       0.3%
        2 => 100, // Silver:     1.0%
        1 => 200, // Bronze:     2.0%
        _ => 500, // Unverified: 5.0%
    }
}

fn max_payment(tier: u32) -> i128 {
    match tier {
        3 => 1_000_000 * 10_000_000,
        2 => 100_000 * 10_000_000,
        1 => 10_000 * 10_000_000,
        _ => 1_000 * 10_000_000,
    }
}

/// Emitted when a payment is processed successfully.
#[contractevent(topics = ["payment"])]
pub struct PaymentEvent {
    #[topic]
    sender: Address,
    #[topic]
    recipient: Address,
    amount: i128,
    fee: i128,
    tier: u32,
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
            soroban_sdk::vec![&env, sender.clone().into_val(&env)],
        );

        if amount <= 0 {
            panic!("Amount must be positive");
        }
        if amount > max_payment(tier) {
            panic!("Amount exceeds tier limit");
        }

        let fee = amount * fee_bps(tier) / 10_000;
        let net = amount - fee;

        let token = token::Client::new(&env, &token_id);

        // ATOMICITY & SAC BATCH TRANSFER CONSIDERATIONS:
        // Stellar Asset Contract (SAC / SEP-41) does not expose a multi-recipient batch transfer method.
        // However, Soroban transactions execute atomically within the host environment.
        // If the second transfer (`token.transfer(&sender, &recipient, &net)`) fails for any reason
        // (e.g. sender has insufficient balance for net, recipient authorization/trustline issue,
        // or contract panic), the unhandled error aborts the entire invocation.
        // Soroban's transactional rollback guarantees that all state changes made during this invocation—
        // including the prior fee transfer to `fee_collector`—are reverted. The sender cannot lose
        // the fee without the net payment completing. An explicit try/catch refund path is therefore
        // unnecessary and discouraged, as Soroban's native host rollback preserves full atomicity.
        if fee > 0 {
            token.transfer(&sender, &fee_collector, &fee);
        }
        token.transfer(&sender, &recipient, &net);

        PaymentEvent {
            sender,
            recipient,
            amount,
            fee,
            tier,
        }
        .publish(&env);
    }

    /// Preview fee and net without executing. Returns (fee, net, tier).
    pub fn quote(env: Env, wallet: Address, amount: i128) -> (i128, i128, u32) {
        let registry: Address = env.storage().instance().get(&REGISTRY_KEY).unwrap();
        let tier: u32 = env.invoke_contract(
            &registry,
            &symbol_short!("get_tier"),
            soroban_sdk::vec![&env, wallet.into_val(&env)],
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
            soroban_sdk::vec![&env, wallet.into_val(&env)],
        );
        max_payment(tier)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env};

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
        assert_eq!(fee, 10_000_000); // 1 XLM
        assert_eq!(net, 990_000_000); // 99 XLM
    }

    #[test]
    fn fee_calculation_gold_zero_rounds_correctly() {
        // 1 stroop Gold: fee = 1 * 30 / 10_000 = 0 (rounds down)
        let fee = fee_bps(3) / 10_000;
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
        let contract_id = env.register(PaymentGate {}, ());
        let client = PaymentGateClient::new(&env, &contract_id);

        let registry = Address::generate(&env);
        client.initialize(&registry);
        // First initialize succeeded; double-init is tested separately.
    }

    #[test]
    #[should_panic(expected = "Already initialized")]
    fn double_initialize_panics() {
        let env = Env::default();
        let contract_id = env.register(PaymentGate {}, ());
        let client = PaymentGateClient::new(&env, &contract_id);

        let registry = Address::generate(&env);
        client.initialize(&registry);
        client.initialize(&registry); // must panic
    }

    // ----------------------------------------------------------------
    // quote() — simulation with mock registry
    // ----------------------------------------------------------------

    /// A stub registry contract that always returns Silver (tier=2).
    mod mock_registry {
        use soroban_sdk::{contract, contractimpl, Address, Env};

        #[contract]
        pub struct MockRegistry;

        #[contractimpl]
        impl MockRegistry {
            pub fn get_tier(_env: Env, _wallet: Address) -> u32 {
                2
            }
        }
    }

    #[test]
    fn quote_returns_correct_fee_and_net_for_silver() {
        let env = Env::default();
        env.mock_all_auths();

        let registry_id = env.register(mock_registry::MockRegistry {}, ());
        let gate_id = env.register(PaymentGate {}, ());
        let client = PaymentGateClient::new(&env, &gate_id);
        client.initialize(&registry_id);

        let wallet = Address::generate(&env);
        let amount: i128 = 1_000_000_000; // 100 XLM in stroops

        let (fee, net, tier) = client.quote(&wallet, &amount);

        // Silver = 1.0% → fee = 10_000_000, net = 990_000_000
        assert_eq!(tier, 2);
        assert_eq!(fee, 10_000_000);
        assert_eq!(net, 990_000_000);
        assert_eq!(fee + net, amount);
    }

    #[test]
    fn quote_returns_correct_fee_for_unverified() {
        let env = Env::default();
        env.mock_all_auths();

        mod mock_unverified {
            use soroban_sdk::{contract, contractimpl, Address, Env};

            #[contract]
            pub struct MockUnverified;

            #[contractimpl]
            impl MockUnverified {
                pub fn get_tier(_env: Env, _wallet: Address) -> u32 {
                    0
                }
            }
        }

        let registry_id = env.register(mock_unverified::MockUnverified {}, ());
        let gate_id = env.register(PaymentGate {}, ());
        let client = PaymentGateClient::new(&env, &gate_id);
        client.initialize(&registry_id);

        let wallet = Address::generate(&env);
        let amount: i128 = 1_000_000_000; // 100 XLM

        let (fee, net, tier) = client.quote(&wallet, &amount);

        // Unverified = 5.0% → fee = 50_000_000, net = 950_000_000
        assert_eq!(tier, 0);
        assert_eq!(fee, 50_000_000);
        assert_eq!(net, 950_000_000);
    }

    // ----------------------------------------------------------------
    // send() — amount validation guards
    // ----------------------------------------------------------------

    #[test]
    #[should_panic(expected = "Amount must be positive")]
    fn send_rejects_zero_amount() {
        let env = Env::default();
        env.mock_all_auths();

        let registry_id = env.register(mock_registry::MockRegistry {}, ());
        let gate_id = env.register(PaymentGate {}, ());
        let client = PaymentGateClient::new(&env, &gate_id);
        client.initialize(&registry_id);

        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let collector = Address::generate(&env);
        let token = Address::generate(&env);
        client.send(&sender, &recipient, &token, &0i128, &collector);
    }

    #[test]
    #[should_panic(expected = "Amount exceeds tier limit")]
    fn send_rejects_amount_over_tier_limit() {
        let env = Env::default();
        env.mock_all_auths();

        // Silver limit = 100_000 XLM = 1_000_000_000_000_000 stroops
        let registry_id = env.register(mock_registry::MockRegistry {}, ());
        let gate_id = env.register(PaymentGate {}, ());
        let client = PaymentGateClient::new(&env, &gate_id);
        client.initialize(&registry_id);

        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let collector = Address::generate(&env);
        let token = Address::generate(&env);

        // Silver max = 100_000 * 10_000_000 stroops; send one stroop over
        let over_limit: i128 = 100_000 * 10_000_000 + 1;
        client.send(&sender, &recipient, &token, &over_limit, &collector);
    }

    // ----------------------------------------------------------------
    // send() — SAC integration & atomicity tests
    // ----------------------------------------------------------------

    #[test]
    fn send_successful_transfers_fee_and_net() {
        let env = Env::default();
        env.mock_all_auths();

        let registry_id = env.register(mock_registry::MockRegistry {}, ());
        let gate_id = env.register(PaymentGate {}, ());
        let client = PaymentGateClient::new(&env, &gate_id);
        client.initialize(&registry_id);

        let token_admin = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_client = token::Client::new(&env, &sac.address());
        let sac_client = token::StellarAssetClient::new(&env, &sac.address());

        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let collector = Address::generate(&env);

        let amount: i128 = 1_000;
        // Silver tier = 1% fee -> fee = 10, net = 990
        sac_client.mint(&sender, &amount);
        assert_eq!(token_client.balance(&sender), 1_000);

        client.send(&sender, &recipient, &sac.address(), &amount, &collector);

        assert_eq!(token_client.balance(&collector), 10);
        assert_eq!(token_client.balance(&recipient), 990);
        assert_eq!(token_client.balance(&sender), 0);
    }

    #[test]
    fn send_atomicity_fee_rolled_back_when_net_transfer_fails_insufficient_net_balance() {
        let env = Env::default();
        env.mock_all_auths();

        let registry_id = env.register(mock_registry::MockRegistry {}, ());
        let gate_id = env.register(PaymentGate {}, ());
        let client = PaymentGateClient::new(&env, &gate_id);
        client.initialize(&registry_id);

        let token_admin = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_client = token::Client::new(&env, &sac.address());
        let sac_client = token::StellarAssetClient::new(&env, &sac.address());

        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let collector = Address::generate(&env);

        let amount: i128 = 1_000;
        // Silver tier (1% fee): fee = 10, net = 990.
        // Fund sender with ONLY 10 stroops (enough for fee, but NOT enough for net transfer).
        sac_client.mint(&sender, &10);
        assert_eq!(token_client.balance(&sender), 10);
        assert_eq!(token_client.balance(&collector), 0);
        assert_eq!(token_client.balance(&recipient), 0);

        // Attempting to send will execute fee transfer (10) first, and then net transfer (990) fails.
        // Soroban's transaction execution model is atomic: the unhandled panic in the second transfer
        // rolls back all state mutations in the invocation, including the first transfer.
        let result = client.try_send(&sender, &recipient, &sac.address(), &amount, &collector);
        assert!(
            result.is_err(),
            "Expected send to fail when net transfer cannot be satisfied"
        );

        // Verify state is completely rolled back:
        // 1. Fee collector did NOT keep the fee.
        assert_eq!(
            token_client.balance(&collector),
            0,
            "Fee collector should have 0 balance due to rollback"
        );
        // 2. Sender did NOT lose the fee.
        assert_eq!(
            token_client.balance(&sender),
            10,
            "Sender balance must be restored due to rollback"
        );
        // 3. Recipient received nothing.
        assert_eq!(
            token_client.balance(&recipient),
            0,
            "Recipient must have 0 balance"
        );
    }

    /// Mock token contract that allows setting a recipient that fails upon transfer
    /// to simulate trustline issues, invalid accounts, or external contract failures.
    mod mock_failing_token {
        use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, Map, Symbol};

        const BALANCES: Symbol = symbol_short!("BALANCES");

        #[contract]
        pub struct MockFailingToken;

        #[contractimpl]
        impl MockFailingToken {
            pub fn mint(env: Env, to: Address, amount: i128) {
                let mut balances: Map<Address, i128> = env
                    .storage()
                    .instance()
                    .get(&BALANCES)
                    .unwrap_or_else(|| Map::new(&env));
                let current = balances.get(to.clone()).unwrap_or(0);
                balances.set(to, current + amount);
                env.storage().instance().set(&BALANCES, &balances);
            }

            pub fn balance(env: Env, id: Address) -> i128 {
                let balances: Map<Address, i128> = env
                    .storage()
                    .instance()
                    .get(&BALANCES)
                    .unwrap_or_else(|| Map::new(&env));
                balances.get(id).unwrap_or(0)
            }

            pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
                // If destination address is configured to simulate trustline/authorization failure, panic!
                if env.storage().instance().has(&to) {
                    panic!("Recipient cannot receive tokens: trustline or authorization failure");
                }

                let mut balances: Map<Address, i128> = env
                    .storage()
                    .instance()
                    .get(&BALANCES)
                    .unwrap_or_else(|| Map::new(&env));
                let from_balance = balances.get(from.clone()).unwrap_or(0);
                if from_balance < amount {
                    panic!("Insufficient balance");
                }
                balances.set(from.clone(), from_balance - amount);
                let to_balance = balances.get(to.clone()).unwrap_or(0);
                balances.set(to, to_balance + amount);
                env.storage().instance().set(&BALANCES, &balances);
            }

            pub fn fail_recipient(env: Env, recipient: Address) {
                env.storage().instance().set(&recipient, &true);
            }
        }
    }

    #[test]
    fn send_atomicity_fee_rolled_back_when_net_transfer_fails_recipient_rejection() {
        let env = Env::default();
        env.mock_all_auths();

        let registry_id = env.register(mock_registry::MockRegistry {}, ());
        let gate_id = env.register(PaymentGate {}, ());
        let client = PaymentGateClient::new(&env, &gate_id);
        client.initialize(&registry_id);

        let token_id = env.register(mock_failing_token::MockFailingToken {}, ());
        let failing_token_client = mock_failing_token::MockFailingTokenClient::new(&env, &token_id);

        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let collector = Address::generate(&env);

        let amount: i128 = 1_000;
        // Mint enough for total amount (fee=10, net=990)
        failing_token_client.mint(&sender, &amount);
        assert_eq!(failing_token_client.balance(&sender), 1_000);

        // Configure recipient to fail on transfer (e.g. simulating missing trustline or revoked auth)
        failing_token_client.fail_recipient(&recipient);

        // Execute send:
        // 1. Fee transfer to collector succeeds.
        // 2. Net transfer to recipient panics with "Recipient cannot receive tokens...".
        let result = client.try_send(&sender, &recipient, &token_id, &amount, &collector);
        assert!(
            result.is_err(),
            "Expected send to fail when recipient transfer panics"
        );

        // Verify atomic rollback across entire invocation:
        // Even though fee transfer succeeded first, host rolled back collector balance to 0.
        assert_eq!(
            failing_token_client.balance(&collector),
            0,
            "Fee transfer must be rolled back"
        );
        assert_eq!(
            failing_token_client.balance(&sender),
            1_000,
            "Sender balance must remain intact"
        );
        assert_eq!(
            failing_token_client.balance(&recipient),
            0,
            "Recipient must not have received tokens"
        );
    }
}
