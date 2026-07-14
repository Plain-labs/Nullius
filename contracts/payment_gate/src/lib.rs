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
