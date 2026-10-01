#![no_std]

use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contractimpl, contracttype,
    crypto::Hash,
    Address, Env, FromVal, Map, String, Val, Vec,
};
use stellar_accounts::{
    policies::spending_limit::SpendingLimitAccountParams,
    smart_account::{
        self, AuthPayload, ContextRule, ContextRuleType, Signer, SmartAccount, SmartAccountError,
    },
};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RecipientPolicyParams {
    pub recipient: Address,
    pub token: Address,
}

#[contract]
pub struct AgentAllowanceTreasury;

#[contractimpl]
impl AgentAllowanceTreasury {
    #[allow(clippy::too_many_arguments)]
    pub fn __constructor(
        e: &Env,
        admin: Address,
        token: Address,
        delegate: Address,
        spending_policy: Address,
        recipient_policy: Address,
        spending_limit: i128,
        period_ledgers: u32,
        recipient: Address,
        valid_until: u32,
    ) {
        let admin_signers = Vec::from_array(e, [Signer::Delegated(admin)]);
        smart_account::add_context_rule(
            e,
            &ContextRuleType::Default,
            &String::from_str(e, "admin"),
            None,
            &admin_signers,
            &Map::new(e),
        );

        let allowance_signers = Vec::from_array(e, [Signer::Delegated(delegate)]);
        let mut policies = Map::<Address, Val>::new(e);
        policies.set(
            spending_policy,
            Val::from_val(
                e,
                &SpendingLimitAccountParams {
                    spending_limit,
                    period_ledgers,
                },
            ),
        );
        policies.set(
            recipient_policy,
            Val::from_val(e, &RecipientPolicyParams { token: token.clone(), recipient }),
        );

        smart_account::add_context_rule(
            e,
            &ContextRuleType::CallContract(token),
            &String::from_str(e, "x402-spend"),
            Some(valid_until),
            &allowance_signers,
            &policies,
        );
    }

    pub fn admin_rule_id() -> u32 {
        0
    }

    pub fn initial_allowance_rule_id() -> u32 {
        1
    }
}

#[contractimpl]
impl CustomAccountInterface for AgentAllowanceTreasury {
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
impl SmartAccount for AgentAllowanceTreasury {}

#[cfg(test)]
mod test {
    use super::*;
    use agentallowance_recipient_policy::{
        AgentAllowanceRecipientPolicy, AgentAllowanceRecipientPolicyClient,
    };
    use agentallowance_spending_limit_policy::{
        AgentAllowanceSpendingLimitPolicy, AgentAllowanceSpendingLimitPolicyClient,
    };
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn constructor_composes_admin_and_expiring_allowance_rules() {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let token = Address::generate(&e);
        let delegate = Address::generate(&e);
        let recipient = Address::generate(&e);
        let spending_policy = e.register(AgentAllowanceSpendingLimitPolicy, ());
        let recipient_policy = e.register(AgentAllowanceRecipientPolicy, ());
        let valid_until = 100u32;

        let treasury = e.register(
            AgentAllowanceTreasury,
            (
                admin.clone(),
                token.clone(),
                delegate.clone(),
                spending_policy.clone(),
                recipient_policy.clone(),
                1_000i128,
                100u32,
                recipient.clone(),
                valid_until,
            ),
        );
        let treasury_client = AgentAllowanceTreasuryClient::new(&e, &treasury);

        assert_eq!(treasury_client.get_context_rules_count(), 2);
        let admin_rule = treasury_client.get_context_rule(&0);
        assert_eq!(admin_rule.context_type, ContextRuleType::Default);
        assert_eq!(admin_rule.signers, Vec::from_array(&e, [Signer::Delegated(admin)]));
        assert!(admin_rule.policies.is_empty());

        let allowance_rule = treasury_client.get_context_rule(&1);
        assert_eq!(allowance_rule.context_type, ContextRuleType::CallContract(token.clone()));
        assert_eq!(allowance_rule.valid_until, Some(valid_until));
        assert_eq!(allowance_rule.signers, Vec::from_array(&e, [Signer::Delegated(delegate)]));
        assert_eq!(allowance_rule.policies.len(), 2);

        let spending = AgentAllowanceSpendingLimitPolicyClient::new(&e, &spending_policy)
            .get_spending_limit_data(&1, &treasury);
        assert_eq!(spending.spending_limit, 1_000);
        assert_eq!(spending.period_ledgers, 100);

        let recipient_config = AgentAllowanceRecipientPolicyClient::new(&e, &recipient_policy)
            .get_config(&1, &treasury);
        assert_eq!(recipient_config.token, token);
        assert_eq!(recipient_config.recipient, recipient);
    }
}
