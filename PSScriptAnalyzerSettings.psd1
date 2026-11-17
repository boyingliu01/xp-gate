# PSScriptAnalyzer rule set for XP-Gate PowerShell product code.
#
# Required by githooks/adapters/powershell.sh whenever
# `.xp-gate-powershell-analysis-paths` is present. The adapter refuses to analyse
# under an unknown rule set, because the alternative -- silently binding to
# PSScriptAnalyzer's defaults -- means a repo that declared its scope also
# swapped its rules without saying so.
#
# Scope of THIS file: rules that are genuine defects in shipped PowerShell.
# Cosmetic and style rules are not enabled here; they are the kind that generate
# work without preventing an incident, and a gate nobody can satisfy gets turned
# off wholesale.
@{
    Severity = @('Error', 'Warning')

    IncludeRules = @(
        # Real failure modes in a script that runs unattended.
        'PSAvoidUsingPlainTextForPassword',
        'PSAvoidUsingConvertToSecureStringWithPlainText',
        'PSAvoidUsingInvokeExpression',
        'PSUseApprovedVerbs',
        'PSUseShouldProcessForStateChangingFunctions',
        'PSAvoidGlobalVars',
        'PSAvoidUsingPositionalParameters',
        'PSAvoidTrailingWhitespace',
        'PSUseDeclaredVarsMoreThanAssignments',
        'PSUseCompatibleSyntax',
        'PSUseCompatibleCommands',
        'PSPossibleIncorrectComparisonWithNull',
        'PSPossibleIncorrectUsageOfAssignmentOperator',
        'PSMissingModuleManifestField',

        # Encoding/BOM correctness -- a PowerShell 5.1 file saved as UTF-8 without
        # a BOM is read as ANSI, which silently corrupts non-ASCII string literals.
        # This repo ships Chinese text in scripts, so the rule is load-bearing.
        'PSUseBOMForUnicodeEncodedFile'
    )

    # PSAvoidUsingWriteHost is intentionally NOT enabled. This repo's scripts are
    # either (a) product code with no host output, or (b) interactive installers
    # that are excluded from scope by .xp-gate-powershell-analysis-paths. Enabling
    # it would only apply to (a), where it finds nothing, while creating pressure
    # to add suppressions in (b) if scope ever broadens.
}
