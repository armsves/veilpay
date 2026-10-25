#![no_std]
//! Veilpay confidential token — OZ `ConfidentialToken` + solvency Hooks.
//!
//! Deposit / withdraw amounts stay public (SEP-41 unwrap); internal balances
//! and transfers remain confidential. SolvencyHooks gate every deposit and
//! withdraw against B/L coverage, atomically reverse (panic) if a withdraw
//! would unbalance, and support a permissionless panic halt when already
//! under-covered.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Bytes, Env, Symbol,
};
use stellar_confidential::{
    storage as confidential, ConfidentialAccount, ConfidentialToken, Hooks, SpenderDelegation,
    WithdrawPayload,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    PanicHalt = 1,
    Insolvent = 2,
    WouldUnbalance = 3,
    InsufficientAssets = 4,
    NotOwner = 5,
    BadAmount = 6,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Owner,
    Assets,      // B — tracked pool assets (underlying held for confidential balances)
    Liabilities, // L — sum of deposits − withdrawals
    Panic,
    MinBps, // min coverage in basis points (10000 = 1.0x)
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SolvencyView {
    pub assets: i128,
    pub liabilities: i128,
    pub coverage_bps: u32, // 0 if L=0 and B=0; u32::MAX if L=0 and B>0
    pub panic_halt: bool,
    pub min_coverage_bps: u32,
}

fn assets(e: &Env) -> i128 {
    e.storage().instance().get(&DataKey::Assets).unwrap_or(0)
}
fn liabilities(e: &Env) -> i128 {
    e.storage()
        .instance()
        .get(&DataKey::Liabilities)
        .unwrap_or(0)
}
fn panic_halt(e: &Env) -> bool {
    e.storage().instance().get(&DataKey::Panic).unwrap_or(false)
}
fn min_bps(e: &Env) -> u32 {
    e.storage()
        .instance()
        .get(&DataKey::MinBps)
        .unwrap_or(10_000)
}
fn set_assets(e: &Env, v: i128) {
    e.storage().instance().set(&DataKey::Assets, &v);
}
fn set_liabilities(e: &Env, v: i128) {
    e.storage().instance().set(&DataKey::Liabilities, &v);
}
fn set_panic(e: &Env, v: bool) {
    e.storage().instance().set(&DataKey::Panic, &v);
}

fn coverage_bps(b: i128, l: i128) -> u32 {
    if l <= 0 {
        return if b > 0 { u32::MAX } else { 0 };
    }
    // bps = floor(B * 10000 / L); saturate
    let scaled = b.saturating_mul(10_000);
    let q = scaled / l;
    if q > i128::from(u32::MAX) {
        u32::MAX
    } else {
        q as u32
    }
}

fn assert_not_halted(e: &Env) {
    if panic_halt(e) {
        panic!("{:?}", Error::PanicHalt);
    }
}

fn assert_solvent(e: &Env) {
    let b = assets(e);
    let l = liabilities(e);
    if l > 0 && coverage_bps(b, l) < min_bps(e) {
        panic!("{:?}", Error::Insolvent);
    }
}

/// Solvency extension for the confidential token.
pub struct SolvencyHooks;

impl Hooks for SolvencyHooks {
    fn on_deposit(e: &Env, _from: &Address, _to: &Address, amount: i128) {
        assert_not_halted(e);
        assert_solvent(e);
        if amount <= 0 {
            panic!("{:?}", Error::BadAmount);
        }
        let b = assets(e).saturating_add(amount);
        let l = liabilities(e).saturating_add(amount);
        set_assets(e, b);
        set_liabilities(e, l);
        // Deposit of equal B/L cannot reduce coverage; still assert.
        assert_solvent(e);
        // Must NOT use protocol names (`deposit` / `withdraw`) — the CT SDK
        // treats those as Map-format confidential events and aborts sync on Vec.
        e.events()
            .publish((symbol_short!("sv_dep"),), (amount, b, l));
    }

    fn on_withdraw(
        e: &Env,
        _from: &Address,
        _to: &Address,
        amount: i128,
        _payload: &WithdrawPayload,
    ) {
        assert_not_halted(e);
        assert_solvent(e);
        if amount <= 0 {
            panic!("{:?}", Error::BadAmount);
        }
        let b = assets(e);
        let l = liabilities(e);
        if b < amount {
            panic!("{:?}", Error::InsufficientAssets);
        }
        let next_b = b - amount;
        let next_l = if l >= amount { l - amount } else { 0 };
        if next_l > 0 && coverage_bps(next_b, next_l) < min_bps(e) {
            // Atomic reverse: panic aborts the whole withdraw tx.
            panic!("{:?}", Error::WouldUnbalance);
        }
        set_assets(e, next_b);
        set_liabilities(e, next_l);
        e.events()
            .publish((symbol_short!("sv_wd"),), (amount, next_b, next_l));
    }
}

#[contract]
pub struct VeilpayConfidentialToken;

#[contractimpl]
impl VeilpayConfidentialToken {
    /// Bind underlying SEP-41 asset + shared verifier/auditor registries.
    /// `min_coverage_bps`: 10000 = 100% (B >= L).
    pub fn __constructor(
        e: &Env,
        owner: Address,
        underlying_asset: Address,
        verifier: Address,
        auditor: Address,
        min_coverage_bps: u32,
    ) {
        confidential::set_underlying_asset(e, &underlying_asset);
        confidential::set_verifier(e, &verifier);
        confidential::set_auditor(e, &auditor);
        confidential::set_address_as_field_element(e);

        e.storage().instance().set(&DataKey::Owner, &owner);
        e.storage()
            .instance()
            .set(&DataKey::MinBps, &min_coverage_bps);
        set_assets(e, 0);
        set_liabilities(e, 0);
        set_panic(e, false);
    }

    pub fn solvency(e: &Env) -> SolvencyView {
        let b = assets(e);
        let l = liabilities(e);
        SolvencyView {
            assets: b,
            liabilities: l,
            coverage_bps: coverage_bps(b, l),
            panic_halt: panic_halt(e),
            min_coverage_bps: min_bps(e),
        }
    }

    /// Permissionless circuit breaker when B/L is already under min coverage.
    pub fn halt_if_insolvent(e: &Env) -> SolvencyView {
        let b = assets(e);
        let l = liabilities(e);
        if l > 0 && coverage_bps(b, l) < min_bps(e) {
            set_panic(e, true);
            e.events()
                .publish((symbol_short!("panic"),), (b, l, Symbol::new(e, "insolvent")));
        }
        Self::solvency(e)
    }

    pub fn force_panic(e: &Env, owner: Address) {
        require_owner(e, &owner);
        set_panic(e, true);
        e.events()
            .publish((symbol_short!("panic"),), (assets(e), liabilities(e), Symbol::new(e, "force")));
    }

    /// Unpause only when coverage is restored.
    pub fn unpause(e: &Env, owner: Address) {
        require_owner(e, &owner);
        assert_solvent(e);
        set_panic(e, false);
        e.events()
            .publish((symbol_short!("unpause"),), (assets(e), liabilities(e)));
    }

    /// Owner tops up assets without minting liabilities (rescue while halted).
    pub fn rescue_deposit(e: &Env, owner: Address, from: Address, amount: i128) {
        require_owner(e, &owner);
        if amount <= 0 {
            panic!("{:?}", Error::BadAmount);
        }
        from.require_auth();
        let underlying = confidential::get_underlying_asset(e);
        let token = soroban_sdk::token::Client::new(e, &underlying);
        token.transfer(&from, &e.current_contract_address(), &amount);
        let b = assets(e).saturating_add(amount);
        set_assets(e, b);
        e.events()
            .publish((symbol_short!("rescue"),), (amount, b, liabilities(e)));
    }

    /// Re-measure pool assets from the underlying balance (detects SAC clawbacks).
    /// If under-covered, panic-halts. Does not invent liabilities.
    pub fn sync_assets(e: &Env) -> SolvencyView {
        let underlying = confidential::get_underlying_asset(e);
        let token = soroban_sdk::token::Client::new(e, &underlying);
        let bal = token.balance(&e.current_contract_address());
        set_assets(e, bal);
        Self::halt_if_insolvent(e)
    }

    pub fn set_min_coverage_bps(e: &Env, owner: Address, bps: u32) {
        require_owner(e, &owner);
        e.storage().instance().set(&DataKey::MinBps, &bps);
    }

    pub fn owner(e: &Env) -> Address {
        e.storage().instance().get(&DataKey::Owner).unwrap()
    }
}

fn require_owner(e: &Env, who: &Address) {
    who.require_auth();
    let owner: Address = e.storage().instance().get(&DataKey::Owner).unwrap();
    if who != &owner {
        panic!("{:?}", Error::NotOwner);
    }
}

#[contractimpl(contracttrait)]
impl ConfidentialToken for VeilpayConfidentialToken {
    type Hooks = SolvencyHooks;
}
