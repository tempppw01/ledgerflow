#!/usr/bin/env python3
"""校验前端 i18n key 完整性。

扫描已接入 t()/tf() 的页面与组件,提取其中用到的翻译 key,
检查 zh / en 两份资源是否都存在。用于逐页英文化时防止漏 key。

用法:
    python scripts/check-i18n-keys.py

有缺失时退出码为 1,可直接接入 CI。
"""

import io
import json
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

FILES = [
    'src/pages/subscriptions/SubscriptionsPage.tsx',
    'src/pages/transaction-edit/TransactionEditPage.tsx',
    'src/pages/database-settings/DatabaseSettingsPage.tsx',
    'src/pages/investments/InvestmentsPage.tsx',
    'src/pages/repayment-management/RepaymentManagementPage.tsx',
    'src/features/debt/components/RepaymentAgentBar.tsx',
    'src/features/debt/components/RepaymentDashboard.tsx',
    'src/features/assistant/investment-chat/InvestmentChatPanel.tsx',
    'src/features/backup/ui/BackupScopeSelector.tsx',
    'src/features/mysql-snapshot/ui/MysqlSnapshotPanel.tsx',
    'src/features/database-provider/ui/DatabaseProviderSetupPanel.tsx',
    'src/pages/dashboard/DashboardPage.tsx',
    'src/features/transactions/components/TransactionFilters.tsx',
    'src/features/transactions/components/TransactionTable.tsx',
    'src/features/exchange/ui/ExchangeConverter.tsx',
    'src/features/exchange/ui/ExchangeRateTable.tsx',
]


def load(lang):
    return json.load(io.open(f'src/i18n/locales/{lang}/translation.json', encoding='utf-8'))


def has_key(tree, key):
    node = tree
    for part in key.split('.'):
        if not isinstance(node, dict) or part not in node:
            return False
        node = node[part]
    return isinstance(node, str)


def main():
    zh, en = load('zh'), load('en')
    missing = {}
    used = set()

    for path in FILES:
        src = io.open(path, encoding='utf-8').read()
        # tf('a.b') / t('a.b') 调用
        used.update(re.findall(r"\btf?f?\(\s*'([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)'", src))
        # 模块级常量里的 { key: 'a.b' }
        used.update(re.findall(r"\bkey:\s*'([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)'", src))

    for key in sorted(used):
        if not has_key(zh, key) or not has_key(en, key):
            missing[key] = [lang for lang in ('zh', 'en') if not has_key(lang == 'zh' and zh or en, key)]

    print(f'checked files: {len(FILES)}, keys used: {len(used)}, missing: {len(missing)}')
    for key, langs in sorted(missing.items()):
        print(f'  MISSING {key} <- {",".join(langs)}')
    return 1 if missing else 0


if __name__ == '__main__':
    sys.exit(main())