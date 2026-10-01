#![no_std]

use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contractimpl,
    crypto::Hash,
    Address, Env, FromVal, Map, String, Val, Vec,
};
use stellar_accounts::{
    policies::spending_limit::SpendingLimitAccountParams,
    smart_account::{
        self, AuthPayload, ContextRule, ContextRuleType, Signer, SmartAccount, SmartAccountError,
    },
};

#[contract]
pub struct X402ProofSmartAccount;

#[contractimpl]
impl X402ProofSmartAccount {
    pub fn __constructor(
        e: &Env,
        token: Address,
        delegate: Address,
        policy: Address,
        spending_limit: i128,
        period_ledgers: u32,
    ) {
        let signers = Vec::from_array(e, [Signer::Delegated(delegate)]);
        let mut policies = Map::<Address, Val>::new(e);
        let params = SpendingLimitAccountParams {
            spending_limit,
            period_ledgers,
        };
        policies.set(policy, Val::from_val(e, &params));

        smart_account::add_context_rule(
            e,
            &ContextRuleType::CallContract(token),
            &String::from_str(e, "x402-spend"),
            None,
            &signers,
            &policies,
        );
    }
}

#[contractimpl]
impl CustomAccountInterface for X402ProofSmartAccount {
    type Error = SmartAccountError;
    type Signature = AuthPayload;

    fn __check_auth(
        e: Env,
        signature_payload: Hash<32>,
        signatures: AuthPayload,
        auth_contexts: Vec<Context>,
    ) -> Result<(), Self::Error> {
        smart_account::do_check_auth(&e, &signature_payload, &signatures, &auth_contexts)
    }
}

#[contractimpl(contracttrait)]
impl SmartAccount for X402ProofSmartAccount {}
