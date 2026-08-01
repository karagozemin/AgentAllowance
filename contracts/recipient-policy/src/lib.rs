#![no_std]

use soroban_sdk::{
    auth::{Context, ContractContext},
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    Env, TryFromVal, Vec,
};
use stellar_accounts::{
    policies::Policy,
    smart_account::{ContextRule, ContextRuleType, Signer},
};

const DAY_IN_LEDGERS: u32 = 17_280;
const EXTEND_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
const TTL_THRESHOLD: u32 = EXTEND_AMOUNT - DAY_IN_LEDGERS;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RecipientPolicyParams {
    pub recipient: Address,
    pub token: Address,
}

#[contracttype]
enum StorageKey {
    AccountContext(Address, u32),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum RecipientPolicyError {
    NotInstalled = 3300,
    AlreadyInstalled = 3301,
    NotAllowed = 3302,
    InvalidConfiguration = 3303,
}

#[contract]
pub struct AgentAllowanceRecipientPolicy;

fn read_params(e: &Env, smart_account: &Address, rule_id: u32) -> RecipientPolicyParams {
    let key = StorageKey::AccountContext(smart_account.clone(), rule_id);
    e.storage()
        .persistent()
        .get(&key)
        .inspect(|_| e.storage().persistent().extend_ttl(&key, TTL_THRESHOLD, EXTEND_AMOUNT))
        .unwrap_or_else(|| panic_with_error!(e, RecipientPolicyError::NotInstalled))
}

fn validate_transfer(
    e: &Env,
    context: &Context,
    smart_account: &Address,
    params: &RecipientPolicyParams,
) -> bool {
    let Context::Contract(ContractContext { contract, fn_name, args }) = context else {
        return false;
    };
    if contract != &params.token || fn_name != &symbol_short!("transfer") || args.len() != 3 {
        return false;
    }

    let Some(from_value) = args.get(0) else { return false };
    let Some(to_value) = args.get(1) else { return false };
    let Some(amount_value) = args.get(2) else { return false };
    let Ok(from) = Address::try_from_val(e, &from_value) else { return false };
    let Ok(to) = Address::try_from_val(e, &to_value) else { return false };
    let Ok(amount) = i128::try_from_val(e, &amount_value) else { return false };

    from == *smart_account && to == params.recipient && amount > 0
}

#[contractimpl]
impl Policy for AgentAllowanceRecipientPolicy {
    type AccountParams = RecipientPolicyParams;

    fn enforce(
        e: &Env,
        context: Context,
        authenticated_signers: Vec<Signer>,
        context_rule: ContextRule,
        smart_account: Address,
    ) {
        smart_account.require_auth();
        if authenticated_signers.is_empty() {
            panic_with_error!(e, RecipientPolicyError::NotAllowed);
        }
        let params = read_params(e, &smart_account, context_rule.id);
        if !validate_transfer(e, &context, &smart_account, &params) {
            panic_with_error!(e, RecipientPolicyError::NotAllowed);
        }
    }

    fn install(
        e: &Env,
        install_params: Self::AccountParams,
        context_rule: ContextRule,
        smart_account: Address,
    ) {
        smart_account.require_auth();
        if install_params.token == install_params.recipient
            || context_rule.context_type != ContextRuleType::CallContract(install_params.token.clone())
        {
            panic_with_error!(e, RecipientPolicyError::InvalidConfiguration);
        }
        let key = StorageKey::AccountContext(smart_account, context_rule.id);
        if e.storage().persistent().has(&key) {
            panic_with_error!(e, RecipientPolicyError::AlreadyInstalled);
        }
        e.storage().persistent().set(&key, &install_params);
        e.storage().persistent().extend_ttl(&key, TTL_THRESHOLD, EXTEND_AMOUNT);
    }

    fn uninstall(e: &Env, context_rule: ContextRule, smart_account: Address) {
        smart_account.require_auth();
        let key = StorageKey::AccountContext(smart_account, context_rule.id);
        if !e.storage().persistent().has(&key) {
            panic_with_error!(e, RecipientPolicyError::NotInstalled);
        }
        e.storage().persistent().remove(&key);
    }
}

#[contractimpl]
impl AgentAllowanceRecipientPolicy {
    pub fn get_config(e: Env, context_rule_id: u32, smart_account: Address) -> RecipientPolicyParams {
        read_params(&e, &smart_account, context_rule_id)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, IntoVal};

    fn contract_context(e: &Env, token: &Address, from: &Address, to: &Address, amount: i128) -> Context {
        let args: Vec<soroban_sdk::Val> = Vec::from_array(
            e,
            [from.clone().into_val(e), to.clone().into_val(e), amount.into_val(e)],
        );
        Context::Contract(ContractContext {
            contract: token.clone(),
            fn_name: symbol_short!("transfer"),
            args,
        })
    }

    #[test]
    fn exact_transfer_is_allowed() {
        let e = Env::default();
        let token = Address::generate(&e);
        let account = Address::generate(&e);
        let recipient = Address::generate(&e);
        let params = RecipientPolicyParams { token: token.clone(), recipient: recipient.clone() };
        let context = contract_context(&e, &token, &account, &recipient, 10);
        assert!(validate_transfer(&e, &context, &account, &params));
    }

    #[test]
    fn wrong_recipient_and_zero_amount_are_denied() {
        let e = Env::default();
        let token = Address::generate(&e);
        let account = Address::generate(&e);
        let recipient = Address::generate(&e);
        let attacker = Address::generate(&e);
        let params = RecipientPolicyParams { token: token.clone(), recipient: recipient.clone() };

        assert!(!validate_transfer(
            &e,
            &contract_context(&e, &token, &account, &attacker, 10),
            &account,
            &params,
        ));
        assert!(!validate_transfer(
            &e,
            &contract_context(&e, &token, &account, &recipient, 0),
            &account,
            &params,
        ));
    }
}
