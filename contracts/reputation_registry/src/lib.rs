#![no_std]
use soroban_sdk::{
    contract, contractevent, contractimpl, symbol_short, Address, Bytes, Env, Symbol, Vec,
};

/// Score tiers stored as u32 — keeps ledger entries small.
pub const TIER_UNVERIFIED: u32 = 0;
pub const TIER_BRONZE: u32 = 1; // threshold >= 40
pub const TIER_SILVER: u32 = 2; // threshold >= 70
pub const TIER_GOLD: u32 = 3; // threshold >= 85

const VERIFIER_KEY: Symbol = symbol_short!("VERIFIER");

/// Emitted when a wallet's reputation tier is set or upgraded.
#[contractevent(topics = ["tier_set"])]
pub struct TierSetEvent {
    caller: Address,
    tier: u32,
}

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

        // Validate byte lengths before making the cross-contract call.
        // The verifier expects BytesN<64/128/64/32>; a mismatch would cause an
        // unhelpful panic deep inside the host. Failing fast here gives callers
        // a clear error and saves the gas of a doomed cross-contract call.
        if proof_a.len() != 64 {
            panic!("proof_a must be 64 bytes (G1 point)");
        }
        if proof_b.len() != 128 {
            panic!("proof_b must be 128 bytes (G2 point)");
        }
        if proof_c.len() != 64 {
            panic!("proof_c must be 64 bytes (G1 point)");
        }
        if commitment.len() != 32 {
            panic!("commitment must be 32 bytes (scalar field element)");
        }

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
            soroban_sdk::vec![
                &env,
                proof_a.into(),
                proof_b.into(),
                proof_c.into(),
                public_inputs.into(),
            ],
        );

        if !verified {
            panic!("ZK proof verification failed");
        }

        // Map threshold to tier — checked after ZK verification
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

        TierSetEvent { caller, tier }.publish(&env);
    }

    /// Get the current reputation tier for a wallet (0 = Unverified).
    pub fn get_tier(env: Env, wallet: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&wallet)
            .unwrap_or(TIER_UNVERIFIED)
    }

    /// Human-readable tier name for frontend display.
    pub fn tier_name(env: Env, tier: u32) -> soroban_sdk::String {
        match tier {
            TIER_GOLD => soroban_sdk::String::from_str(&env, "Gold"),
            TIER_SILVER => soroban_sdk::String::from_str(&env, "Silver"),
            TIER_BRONZE => soroban_sdk::String::from_str(&env, "Bronze"),
            _ => soroban_sdk::String::from_str(&env, "Unverified"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env};

    // ----------------------------------------------------------------
    // Tier constant sanity checks
    // ----------------------------------------------------------------

    #[test]
    fn tier_constants_ordered() {
        const { assert!(TIER_UNVERIFIED < TIER_BRONZE) };
        const { assert!(TIER_BRONZE < TIER_SILVER) };
        const { assert!(TIER_SILVER < TIER_GOLD) };
    }

    #[test]
    fn tier_constants_values() {
        assert_eq!(TIER_UNVERIFIED, 0);
        assert_eq!(TIER_BRONZE, 1);
        assert_eq!(TIER_SILVER, 2);
        assert_eq!(TIER_GOLD, 3);
    }

    // ----------------------------------------------------------------
    // initialize / double-initialize
    // ----------------------------------------------------------------

    #[test]
    #[should_panic(expected = "Already initialized")]
    fn double_initialize_panics() {
        let env = Env::default();
        let cid = env.register(ReputationRegistry {}, ());
        let client = ReputationRegistryClient::new(&env, &cid);

        let verifier = Address::generate(&env);
        client.initialize(&verifier);
        client.initialize(&verifier); // must panic
    }

    // ----------------------------------------------------------------
    // get_tier default (no proof submitted)
    // ----------------------------------------------------------------

    #[test]
    fn get_tier_returns_unverified_by_default() {
        let env = Env::default();
        let cid = env.register(ReputationRegistry {}, ());
        let client = ReputationRegistryClient::new(&env, &cid);

        let verifier = Address::generate(&env);
        client.initialize(&verifier);

        let wallet = Address::generate(&env);
        let tier = client.get_tier(&wallet);
        assert_eq!(tier, TIER_UNVERIFIED);
    }

    // ----------------------------------------------------------------
    // tier_name correctness
    // ----------------------------------------------------------------

    #[test]
    fn tier_name_gold() {
        let env = Env::default();
        let cid = env.register(ReputationRegistry {}, ());
        let client = ReputationRegistryClient::new(&env, &cid);
        let verifier = Address::generate(&env);
        client.initialize(&verifier);

        let name = client.tier_name(&TIER_GOLD);
        assert_eq!(name, soroban_sdk::String::from_str(&env, "Gold"));
    }

    #[test]
    fn tier_name_silver() {
        let env = Env::default();
        let cid = env.register(ReputationRegistry {}, ());
        let client = ReputationRegistryClient::new(&env, &cid);
        let verifier = Address::generate(&env);
        client.initialize(&verifier);

        let name = client.tier_name(&TIER_SILVER);
        assert_eq!(name, soroban_sdk::String::from_str(&env, "Silver"));
    }

    #[test]
    fn tier_name_bronze() {
        let env = Env::default();
        let cid = env.register(ReputationRegistry {}, ());
        let client = ReputationRegistryClient::new(&env, &cid);
        let verifier = Address::generate(&env);
        client.initialize(&verifier);

        let name = client.tier_name(&TIER_BRONZE);
        assert_eq!(name, soroban_sdk::String::from_str(&env, "Bronze"));
    }

    #[test]
    fn tier_name_unverified() {
        let env = Env::default();
        let cid = env.register(ReputationRegistry {}, ());
        let client = ReputationRegistryClient::new(&env, &cid);
        let verifier = Address::generate(&env);
        client.initialize(&verifier);

        let name = client.tier_name(&TIER_UNVERIFIED);
        assert_eq!(name, soroban_sdk::String::from_str(&env, "Unverified"));
    }

    #[test]
    fn tier_name_unknown_value() {
        let env = Env::default();
        let cid = env.register(ReputationRegistry {}, ());
        let client = ReputationRegistryClient::new(&env, &cid);
        let verifier = Address::generate(&env);
        client.initialize(&verifier);

        let name = client.tier_name(&99u32);
        assert_eq!(name, soroban_sdk::String::from_str(&env, "Unverified"));
    }

    // ----------------------------------------------------------------
    // Byte-length validation in submit_proof
    // ----------------------------------------------------------------

    #[test]
    #[should_panic(expected = "proof_a must be 64 bytes")]
    fn submit_proof_rejects_short_proof_a() {
        let env = Env::default();
        env.mock_all_auths();
        let cid = env.register(ReputationRegistry {}, ());
        let client = ReputationRegistryClient::new(&env, &cid);
        let dummy_verifier = Address::generate(&env);
        client.initialize(&dummy_verifier);
        let wallet = Address::generate(&env);
        let bad_proof = soroban_sdk::Bytes::from_slice(&env, &[0u8; 32]); // too short
        let zero64 = soroban_sdk::Bytes::from_slice(&env, &[0u8; 64]);
        let zero128 = soroban_sdk::Bytes::from_slice(&env, &[0u8; 128]);
        let zero32 = soroban_sdk::Bytes::from_slice(&env, &[0u8; 32]);
        client.submit_proof(&wallet, &85u32, &bad_proof, &zero128, &zero64, &zero32);
    }

    #[test]
    #[should_panic(expected = "proof_b must be 128 bytes")]
    fn submit_proof_rejects_short_proof_b() {
        let env = Env::default();
        env.mock_all_auths();
        let cid = env.register(ReputationRegistry {}, ());
        let client = ReputationRegistryClient::new(&env, &cid);
        let dummy_verifier = Address::generate(&env);
        client.initialize(&dummy_verifier);
        let wallet = Address::generate(&env);
        let zero64 = soroban_sdk::Bytes::from_slice(&env, &[0u8; 64]);
        let bad_proof = soroban_sdk::Bytes::from_slice(&env, &[0u8; 64]); // should be 128
        let zero32 = soroban_sdk::Bytes::from_slice(&env, &[0u8; 32]);
        client.submit_proof(&wallet, &85u32, &zero64, &bad_proof, &zero64, &zero32);
    }

    #[test]
    #[should_panic(expected = "commitment must be 32 bytes")]
    fn submit_proof_rejects_bad_commitment_length() {
        let env = Env::default();
        env.mock_all_auths();
        let cid = env.register(ReputationRegistry {}, ());
        let client = ReputationRegistryClient::new(&env, &cid);
        let dummy_verifier = Address::generate(&env);
        client.initialize(&dummy_verifier);
        let wallet = Address::generate(&env);
        let zero64 = soroban_sdk::Bytes::from_slice(&env, &[0u8; 64]);
        let zero128 = soroban_sdk::Bytes::from_slice(&env, &[0u8; 128]);
        let bad_commitment = soroban_sdk::Bytes::from_slice(&env, &[0u8; 16]); // too short
        client.submit_proof(&wallet, &85u32, &zero64, &zero128, &zero64, &bad_commitment);
    }

    #[test]
    #[should_panic(expected = "Threshold too low")]
    fn submit_proof_rejects_threshold_below_40() {
        let env = Env::default();
        env.mock_all_auths();
        let cid = env.register(ReputationRegistry {}, ());
        let client = ReputationRegistryClient::new(&env, &cid);
        let dummy_verifier = Address::generate(&env);
        client.initialize(&dummy_verifier);
        let wallet = Address::generate(&env);
        let zero32 = soroban_sdk::Bytes::from_slice(&env, &[0u8; 32]);
        let zero64 = soroban_sdk::Bytes::from_slice(&env, &[0u8; 64]);
        let zero128 = soroban_sdk::Bytes::from_slice(&env, &[0u8; 128]);
        // threshold=39 must panic with "Threshold too low"
        client.submit_proof(&wallet, &39u32, &zero64, &zero128, &zero64, &zero32);
    }

    // ----------------------------------------------------------------
    // submit_proof success path — mock verifier that always returns true
    // ----------------------------------------------------------------

    mod mock_verifier {
        use soroban_sdk::{contract, contractimpl, BytesN, Env, Vec};

        /// Stub Groth16 verifier that always approves any proof.
        #[contract]
        pub struct AlwaysTrueVerifier;

        #[contractimpl]
        impl AlwaysTrueVerifier {
            pub fn verify(
                _env: Env,
                _proof_a: BytesN<64>,
                _proof_b: BytesN<128>,
                _proof_c: BytesN<64>,
                _public_inputs: Vec<BytesN<32>>,
            ) -> bool {
                true
            }
        }
    }

    /// Helper to build correct-length proof bytes for submit_proof calls.
    fn make_proof_bytes(
        env: &Env,
    ) -> (
        soroban_sdk::Bytes,
        soroban_sdk::Bytes,
        soroban_sdk::Bytes,
        soroban_sdk::Bytes,
    ) {
        (
            soroban_sdk::Bytes::from_slice(env, &[0u8; 64]), // proof_a
            soroban_sdk::Bytes::from_slice(env, &[0u8; 128]), // proof_b
            soroban_sdk::Bytes::from_slice(env, &[0u8; 64]), // proof_c
            soroban_sdk::Bytes::from_slice(env, &[0u8; 32]), // commitment
        )
    }

    #[test]
    fn submit_proof_gold_sets_gold_tier() {
        let env = Env::default();
        env.mock_all_auths();
        let verifier_id = env.register(mock_verifier::AlwaysTrueVerifier {}, ());
        let registry_id = env.register(ReputationRegistry {}, ());
        let client = ReputationRegistryClient::new(&env, &registry_id);
        client.initialize(&verifier_id);
        let wallet = Address::generate(&env);
        let (pa, pb, pc, cm) = make_proof_bytes(&env);
        client.submit_proof(&wallet, &85u32, &pa, &pb, &pc, &cm);
        assert_eq!(client.get_tier(&wallet), TIER_GOLD);
    }

    #[test]
    fn submit_proof_silver_sets_silver_tier() {
        let env = Env::default();
        env.mock_all_auths();
        let verifier_id = env.register(mock_verifier::AlwaysTrueVerifier {}, ());
        let registry_id = env.register(ReputationRegistry {}, ());
        let client = ReputationRegistryClient::new(&env, &registry_id);
        client.initialize(&verifier_id);
        let wallet = Address::generate(&env);
        let (pa, pb, pc, cm) = make_proof_bytes(&env);
        client.submit_proof(&wallet, &70u32, &pa, &pb, &pc, &cm);
        assert_eq!(client.get_tier(&wallet), TIER_SILVER);
    }

    #[test]
    fn submit_proof_bronze_sets_bronze_tier() {
        let env = Env::default();
        env.mock_all_auths();
        let verifier_id = env.register(mock_verifier::AlwaysTrueVerifier {}, ());
        let registry_id = env.register(ReputationRegistry {}, ());
        let client = ReputationRegistryClient::new(&env, &registry_id);
        client.initialize(&verifier_id);
        let wallet = Address::generate(&env);
        let (pa, pb, pc, cm) = make_proof_bytes(&env);
        client.submit_proof(&wallet, &40u32, &pa, &pb, &pc, &cm);
        assert_eq!(client.get_tier(&wallet), TIER_BRONZE);
    }

    #[test]
    fn submit_proof_upgrade_allowed() {
        let env = Env::default();
        env.mock_all_auths();
        let verifier_id = env.register(mock_verifier::AlwaysTrueVerifier {}, ());
        let registry_id = env.register(ReputationRegistry {}, ());
        let client = ReputationRegistryClient::new(&env, &registry_id);
        client.initialize(&verifier_id);
        let wallet = Address::generate(&env);
        let (pa, pb, pc, cm) = make_proof_bytes(&env);

        // First submit: Bronze
        client.submit_proof(&wallet, &40u32, &pa, &pb, &pc, &cm);
        assert_eq!(client.get_tier(&wallet), TIER_BRONZE);

        // Upgrade to Gold
        client.submit_proof(&wallet, &85u32, &pa, &pb, &pc, &cm);
        assert_eq!(client.get_tier(&wallet), TIER_GOLD);
    }

    #[test]
    fn submit_proof_downgrade_not_allowed() {
        let env = Env::default();
        env.mock_all_auths();
        let verifier_id = env.register(mock_verifier::AlwaysTrueVerifier {}, ());
        let registry_id = env.register(ReputationRegistry {}, ());
        let client = ReputationRegistryClient::new(&env, &registry_id);
        client.initialize(&verifier_id);
        let wallet = Address::generate(&env);
        let (pa, pb, pc, cm) = make_proof_bytes(&env);

        // First submit: Gold
        client.submit_proof(&wallet, &85u32, &pa, &pb, &pc, &cm);
        assert_eq!(client.get_tier(&wallet), TIER_GOLD);

        // Attempt downgrade to Bronze — tier must stay Gold
        client.submit_proof(&wallet, &40u32, &pa, &pb, &pc, &cm);
        assert_eq!(
            client.get_tier(&wallet),
            TIER_GOLD,
            "Downgrade must be silently ignored"
        );
    }
}
