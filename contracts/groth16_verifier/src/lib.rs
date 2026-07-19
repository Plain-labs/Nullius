#![no_std]
mod vk_bytes;
use soroban_sdk::{
    contract, contractimpl,
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    BytesN, Env, Vec,
};

/// Groth16 proof verifier using Stellar's native BN254 host functions.
/// Adapted for the ReputationScore circuit (soroban-sdk 27 API).
///
/// Proof (π):
///   proof_a — G1 point (64 bytes, uncompressed)
///   proof_b — G2 point (128 bytes, uncompressed)
///   proof_c — G1 point (64 bytes, uncompressed)
///
/// Public inputs for ReputationScore circuit:
///   [0] threshold       — minimum score tier claimed (32-byte big-endian scalar)
///   [1] commitment      — Poseidon hash binding proof to user data (32-byte scalar)
///   [2] meets_threshold — must equal scalar 1; enforced here too

#[contract]
pub struct Groth16Verifier;

#[contractimpl]
impl Groth16Verifier {
    /// Verify a Groth16 proof.
    /// Returns true iff proof is valid AND meets_threshold public input == 1.
    ///
    /// After running circuits/scripts/setup.sh, replace the placeholder
    /// zero-bytes below with the actual VK points from verification_key.json.
    pub fn verify(
        env: Env,
        proof_a: BytesN<64>,
        proof_b: BytesN<128>,
        proof_c: BytesN<64>,
        public_inputs: Vec<BytesN<32>>,
    ) -> bool {
        let bn254 = env.crypto().bn254();

        // ----------------------------------------------------------------
        // Verification key — TODO: replace with real values after setup
        // ----------------------------------------------------------------
        let vk_alpha = Bn254G1Affine::from_bytes(BytesN::from_array(&env, &vk_bytes::VK_ALPHA));
        let vk_beta = Bn254G2Affine::from_bytes(BytesN::from_array(&env, &vk_bytes::VK_BETA));
        let vk_gamma = Bn254G2Affine::from_bytes(BytesN::from_array(&env, &vk_bytes::VK_GAMMA));
        let vk_delta = Bn254G2Affine::from_bytes(BytesN::from_array(&env, &vk_bytes::VK_DELTA));

        // IC[0..3] for 3 public inputs
        let vk_ic_0 = Bn254G1Affine::from_bytes(BytesN::from_array(&env, &vk_bytes::VK_IC_0));
        let vk_ic_1 = Bn254G1Affine::from_bytes(BytesN::from_array(&env, &vk_bytes::VK_IC_1));
        let vk_ic_2 = Bn254G1Affine::from_bytes(BytesN::from_array(&env, &vk_bytes::VK_IC_2));
        let vk_ic_3 = Bn254G1Affine::from_bytes(BytesN::from_array(&env, &vk_bytes::VK_IC_3));

        // ----------------------------------------------------------------
        // 1. Compute vk_x = IC[0] + MSM(IC[1..3], public_inputs)
        // ----------------------------------------------------------------
        let s0 = Bn254Fr::from_bytes(public_inputs.get(0).unwrap());
        let s1 = Bn254Fr::from_bytes(public_inputs.get(1).unwrap());
        let s2 = Bn254Fr::from_bytes(public_inputs.get(2).unwrap());

        let ic_points = Vec::from_array(&env, [vk_ic_1, vk_ic_2, vk_ic_3]);
        let scalars = Vec::from_array(&env, [s0, s1, s2]);

        let msm = bn254.g1_msm(ic_points, scalars);
        let vk_x = bn254.g1_add(&vk_ic_0, &msm);

        // ----------------------------------------------------------------
        // 2. Pairing check:
        //    e(-π_a, π_b) · e(α, β) · e(vk_x, γ) · e(π_c, δ) == 1
        // ----------------------------------------------------------------
        let proof_a_pt = Bn254G1Affine::from_bytes(proof_a);
        let proof_b_pt = Bn254G2Affine::from_bytes(proof_b);
        let proof_c_pt = Bn254G1Affine::from_bytes(proof_c);

        let proof_a_neg = -proof_a_pt; // Neg impl: (X, -Y)

        let g1_points = Vec::from_array(&env, [proof_a_neg, vk_alpha, vk_x, proof_c_pt]);
        let g2_points = Vec::from_array(&env, [proof_b_pt, vk_beta, vk_gamma, vk_delta]);

        let pairing_ok = bn254.pairing_check(g1_points, g2_points);

        // ----------------------------------------------------------------
        // 3. Enforce meets_threshold public input == field element 1
        // ----------------------------------------------------------------
        let one_bytes: BytesN<32> = {
            let mut b = [0u8; 32];
            b[31] = 1;
            BytesN::from_array(&env, &b)
        };
        let threshold_met = public_inputs.get(2).unwrap() == one_bytes;

        pairing_ok && threshold_met
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::Env;

    fn zero_g1(env: &Env) -> BytesN<64> {
        BytesN::from_array(env, &[0u8; 64])
    }
    fn zero_g2(env: &Env) -> BytesN<128> {
        BytesN::from_array(env, &[0u8; 128])
    }
    fn zero_s(env: &Env) -> BytesN<32> {
        BytesN::from_array(env, &[0u8; 32])
    }
    fn one_s(env: &Env) -> BytesN<32> {
        let mut b = [0u8; 32];
        b[31] = 1;
        BytesN::from_array(env, &b)
    }

    #[test]
    fn test_verify_rejects_zero_proof_meets_threshold_zero() {
        let env = Env::default();
        let cid = env.register_contract(None, Groth16Verifier);
        let client = Groth16VerifierClient::new(&env, &cid);

        let mut inputs = Vec::new(&env);
        inputs.push_back(zero_s(&env)); // threshold
        inputs.push_back(zero_s(&env)); // commitment
        inputs.push_back(zero_s(&env)); // meets_threshold = 0 → reject

        let result = client.verify(&zero_g1(&env), &zero_g2(&env), &zero_g1(&env), &inputs);
        assert!(!result, "meets_threshold=0 must be rejected");
    }

    #[test]
    fn test_verify_rejects_when_meets_threshold_is_not_one() {
        let env = Env::default();
        let cid = env.register_contract(None, Groth16Verifier);
        let client = Groth16VerifierClient::new(&env, &cid);

        let mut two_bytes = [0u8; 32];
        two_bytes[31] = 2;
        let two = BytesN::from_array(&env, &two_bytes);

        let mut inputs = Vec::new(&env);
        inputs.push_back(zero_s(&env)); // threshold
        inputs.push_back(zero_s(&env)); // commitment
        inputs.push_back(two); // meets_threshold = 2 → reject

        let result = client.verify(&zero_g1(&env), &zero_g2(&env), &zero_g1(&env), &inputs);
        assert!(!result, "meets_threshold != 1 must be rejected");
    }

    #[test]
    fn test_public_inputs_field_element_one_encoding() {
        let env = Env::default();
        let one = one_s(&env);
        let bytes = one.to_array();
        assert_eq!(bytes[31], 1, "LSB should be 1");
        for i in 0..31 {
            assert_eq!(bytes[i], 0, "All high bytes should be zero");
        }
    }
}
