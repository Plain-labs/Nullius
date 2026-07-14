#![no_std]
use soroban_sdk::{contract, contractimpl, Bytes, Env, Vec};

/// Groth16 proof verifier using Stellar's native BN254 host functions.
/// Adapted from soroban-examples/groth16_verifier for the ReputationScore circuit.
///
/// Proof (π):
///   proof_a — G1 point (64 bytes, uncompressed)
///   proof_b — G2 point (128 bytes, uncompressed)
///   proof_c — G1 point (64 bytes, uncompressed)
//
/// Public inputs for ReputationScore circuit:
///   [0] threshold       — minimum score tier claimed (field element, 32 bytes)
///   [1] commitment      — Poseidon hash binding proof to user dat
///   [2] meets_threshold — must equal field element 1; enforced here too

#[contract]
pub struct Groth16Verifier;

#[contractimpl]
impl Groth16Verifier {
    /// Verify a Groth16 proof.
    /// Returns true iff proof is valid AND meets_threshold public input == 1.
    ///
    /// After running circuits/scripts/setup.sh, replace the placeholder
    /// zero-bytes below with the actual VK points from verification_key.json.
    /// Use `npx snarkjs zkey export solidityverifier` to get the hex values,
    /// then convert to uncompressed big-endian bytes.
    pub fn verify(
        env: Env,
        proof_a: Bytes,
        proof_b: Bytes,
        proof_c: Bytes,
        public_inputs: Vec<Bytes>,
    ) -> bool {
        // ----------------------------------------------------------------
        // Verification key — TODO: replace with real values after setup
        // ----------------------------------------------------------------
        let vk_alpha = Bytes::from_slice(&env, &[0u8; 64]);
        let vk_beta  = Bytes::from_slice(&env, &[0u8; 128]);
        let vk_gamma = Bytes::from_slice(&env, &[0u8; 128]);
        let vk_delta = Bytes::from_slice(&env, &[0u8; 128]);
        // IC[0..3] for 3 public inputs
        let vk_ic_0 = Bytes::from_slice(&env, &[0u8; 64]);
        let vk_ic_1 = Bytes::from_slice(&env, &[0u8; 64]);
        let vk_ic_2 = Bytes::from_slice(&env, &[0u8; 64]);
        let vk_ic_3 = Bytes::from_slice(&env, &[0u8; 64]);

        // ----------------------------------------------------------------
        // 1. Compute vk_x = IC[0] + sum(public_inputs[i] * IC[i+1])
        //    using Stellar's native bn254_g1_msm host function
        // ----------------------------------------------------------------
        let scalars   = Vec::from_array(&env, [
            public_inputs.get(0).unwrap(),
            public_inputs.get(1).unwrap(),
            public_inputs.get(2).unwrap(),
        ]);
        let ic_points = Vec::from_array(&env, [
            vk_ic_1,
            vk_ic_2,
            vk_ic_3,
        ]);

        let msm   = env.crypto().bn254_g1_msm(ic_points, scalars);
        let vk_x  = env.crypto().bn254_g1_add(vk_ic_0, msm);

        // ----------------------------------------------------------------
        // 2. Pairing check (Miller loop + final exponentiation):
        //    e(-π_a, π_b) · e(α, β) · e(vk_x, γ) · e(π_c, δ) == 1
        // ----------------------------------------------------------------
        let proof_a_neg = env.crypto().bn254_g1_neg(proof_a);

        let g1_points = Vec::from_array(&env, [
            proof_a_neg,
            vk_alpha,
            vk_x,
            proof_c,
        ]);
        let g2_points = Vec::from_array(&env, [
            proof_b,
            vk_beta,
            vk_gamma,
            vk_delta,
        ]);

        let pairing_ok = env.crypto().bn254_pairing_check(g1_points, g2_points);

        // ----------------------------------------------------------------
        // 3. Enforce meets_threshold public input == field element 1
        // ----------------------------------------------------------------
        let one = Bytes::from_slice(&env, &{
            let mut b = [0u8; 32];
            b[31] = 1;
            b
        });
        let threshold_met = public_inputs.get(2).unwrap() == one;

        pairing_ok && threshold_met
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn test_verify_rejects_zero_proof() {
        let env = Env::default();
        let contract_id = env.register_contract(None, Groth16Verifier);
        let client = Groth16VerifierClient::new(&env, &contract_id);

        let zero_g1 = Bytes::from_slice(&env, &[0u8; 64]);
        let zero_g2 = Bytes::from_slice(&env, &[0u8; 128]);
        let zero_scalar = Bytes::from_slice(&env, &[0u8; 32]);

        let mut public_inputs = Vec::new(&env);
        public_inputs.push_back(zero_scalar.clone()); // threshold
        public_inputs.push_back(zero_scalar.clone()); // commitment
        public_inputs.push_back(zero_scalar.clone()); // meets_threshold = 0, should fail

        let result = client.verify(
            &zero_g1.clone(),
            &zero_g2.clone(),
            &zero_g1.clone(),
            &public_inputs,
        );
        assert!(!result, "Zero proof with meets_threshold=0 should be rejected");
    }
}
