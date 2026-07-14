#![no_std]
use soroban_sdk::{
    contract, contractimpl, symbol_short, Address, Bytes, Env, Symbol, Vec,
};

/// Score tiers stored as u32 — keeps ledger entries small.
pub const TIER_UNVERIFIED: u32 = 0;
pub const TIER_BRONZE: u32     = 1; // threshold >= 40
pub const TIER_SILVER: u32     = 2; // threshold >= 70
pub const TIER_GOLD: u32       = 3; // threshold >= 85

const VERIFIER_KEY: Symbol = symbol_short!("VERIFIER");

#[contract]
pub struct ReputationRegistry;

#[contractimpl]
impl ReputationRegistry {
    /// Initialize with the address of the deployed Groth16Verifier contract.
    pub fn initialize(env: Env, verifier: Address) {
        if env.storage().instance().has(&VERIFIER_KEY) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&VERIFIER_KEY, &verifier);
    }

    /// Submit a ZK proof to claim/update a reputation tier.
    ///
    /// The registry cross-calls the verifier contract. If the proof is valid,
    /// it records the tier against the caller's address.
    /// Raw financial data never reaches this contract.
    pub fn submit_proof(
        env: Env,
        caller: Address,
        threshold: u32,
        proof_a: Bytes,
        proof_b: Bytes,
        proof_c: Bytes,
        commitment: Bytes,
    ) {
        caller.require_auth();

        // Encode threshold as 32-byte big-endian field element
        let threshold_bytes = Bytes::from_slice(&env, &{
            let mut b = [0u8; 32];
            let t = threshold.to_be_bytes();
            b[28..32].copy_from_slice(&t);
            b
        });

        // meets_threshold public input must be 1
        let one_bytes = Bytes::from_slice(&env, &{
            let mut b = [0u8; 32];
            b[31] = 1;
            b
        });

        let mut public_inputs: Vec<Bytes> = Vec::new(&env);
        public_inputs.push_back(threshold_bytes);
        public_inputs.push_back(commitment);
        public_inputs.push_back(one_bytes);

        // Cross-contract call to verifier
        let verifier: Address = env.storage().instance().get(&VERIFIER_KEY).unwrap();
        let verified: bool = env.invoke_contract(
            &verifier,
            &symbol_short!("verify"),
            soroban_sdk::vec![&env,
                proof_a.into(),
                proof_b.into(),
                proof_c.into(),
                public_inputs.into(),
            ],
        );

        if !verified {
            panic!("ZK proof verification failed");
        }

        // Map threshold to tier
        let tier: u32 = if threshold >= 85 {
            TIER_GOLD
        } else if threshold >= 70 {
            TIER_SILVER
        } else if threshold >= 40 {
            TIER_BRONZE
        } else {
            panic!("Threshold too low — minimum is 40 (Bronze)");
        };

        // Only allow upgrades, not downgrades
        let current_tier: u32 = env.storage().persistent().get(&caller).unwrap_or(0);
        if tier > current_tier {
            env.storage().persistent().set(&caller, &tier);
        }

        env.events().publish(
            (symbol_short!("tier_set"),),
            (caller, tier),
        );
    }

    /// Get the current reputation tier for a wallet (0 = Unverified).
    pub fn get_tier(env: Env, wallet: Address) -> u32 {
        env.storage().persistent().get(&wallet).unwrap_or(TIER_UNVERIFIED)
    }

    /// Human-readable tier name for frontend display.
    pub fn tier_name(env: Env, tier: u32) -> soroban_sdk::String {
        match tier {
            TIER_GOLD   => soroban_sdk::String::from_str(&env, "Gold"),
            TIER_SILVER => soroban_sdk::String::from_str(&env, "Silver"),
            TIER_BRONZE => soroban_sdk::String::from_str(&env, "Bronze"),
            _           => soroban_sdk::String::from_str(&env, "Unverified"),
        }
    }
}
