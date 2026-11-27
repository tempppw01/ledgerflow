import { ACCOUNT_TYPE_ICON_KIND, type AccountPreset } from '../model/accountTypes';
import { AccountIcon } from './accountIcons';
import { useTranslation } from 'react-i18next';

interface AccountPresetPickerProps {
  presets: AccountPreset[];
  onSelect: (preset: AccountPreset) => void;
}

export function AccountPresetPicker({ presets, onSelect }: AccountPresetPickerProps) {
  const { t } = useTranslation();

  return (
    <div className="account-preset-picker">
      {presets.map((preset) => (
        <button
          key={preset.name}
          type="button"
          className="account-preset-chip"
          onClick={() => onSelect(preset)}
          title={t('accounts.presetQuickAddTitle', { name: preset.name })}
        >
          <span className="preset-icon">
            {preset.iconUrl ? (
              <img
                className="account-preset-brand-icon"
                src={preset.iconUrl}
                alt=""
                aria-hidden="true"
              />
            ) : (
              /* 没有品牌图时按账户类型给线性图标,不再用 emoji(理由见 accountIcons.tsx)。 */
              <AccountIcon
                className="account-preset-fallback-icon"
                kind={ACCOUNT_TYPE_ICON_KIND[preset.type]}
              />
            )}
          </span>
          {preset.name}
        </button>
      ))}
    </div>
  );
}
