# Source-only integration; independently sourceable, no shared runner edit.
mutt_wizard_integration_case() {
	[ -x /usr/local/bin/python3 ] || skip 'existing python3 not installed'
	[ -x /usr/local/bin/neomutt ] || skip 'native NeoMutt not installed'
	[ -x /usr/local/bin/mbsync ] || skip 'native isync not installed'
	(
		unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR
		unset PASSWORD_STORE_DIR PASSWORD_STORE_KEY PASSWORD_STORE_SIGNING_KEY GNUPGHOME
		# Like the core runner, permit a private short HOME-filesystem root:
		# deeply nested runner TMPDIR exceeds native gpg-agent socket limits.
		TMPDIR="${MW_FIXTURE_TMPDIR:-${TMPDIR:-/tmp}}" PYTHONDONTWRITEBYTECODE=1 \
			/usr/local/bin/python3 "$REPO/.local/share/vertrice/tests/mutt-wizard-integration.py" "$@"
	) >"$T/mw-integration-out" 2>&1 || fail "$(cat "$T/mw-integration-out")"
}
t_mutt_wizard_integration_guard() { mutt_wizard_integration_case Plumbing.test_integration_shared_prefix_guard Plumbing.test_integration_existing_openbsd_path_selection; }
t_mutt_wizard_integration_build() { mutt_wizard_integration_case Plumbing.test_integration_bundle_and_all_asset_drift; }
t_mutt_wizard_integration_pass() { mutt_wizard_integration_case Plumbing.test_integration_generated_passcmd_native Plumbing.test_integration_passcmd_runtime_shell_options; }
t_mutt_wizard_integration_sync() { mutt_wizard_integration_case Plumbing.test_integration_manual_generated_command_and_refusal Plumbing.test_integration_native_maildir_pullnew; }
t_mutt_wizard_integration_mailto() { mutt_wizard_integration_case Plumbing.test_integration_mailto_desktop_contract; }
t_mutt_wizard_integration_attachment() { mutt_wizard_integration_case Plumbing.test_integration_mailcap_native_attachment; }
t_mutt_wizard_integration_profile() { mutt_wizard_integration_case Profile.test_integration_enrollment_default_switch_compose; }
t_mutt_wizard_integration_inbox_recovery() { mutt_wizard_integration_case Profile.test_integration_postcommit_inbox_refusal_recovery; }
t_mutt_wizard_integration_namespace_pass() { mutt_wizard_integration_case Profile.test_integration_namespace_native_bound_passcmd; }
