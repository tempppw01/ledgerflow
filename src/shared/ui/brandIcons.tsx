import type { SVGProps } from 'react';
import { resolveAiModelFamily } from './brandIconResolvers';
import type { AiModelFamily, AiProviderKey, WebSearchServiceKey } from './brandIconResolvers';

export type { AiModelFamily, AiProviderKey, WebSearchServiceKey } from './brandIconResolvers';

export type BrandIconProps = Omit<SVGProps<SVGSVGElement>, 'children'>;

const frame: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  focusable: 'false',
  'aria-hidden': true
};

export function ShApiIcon(props: BrandIconProps) {
  return (
    <svg {...frame} {...props}>
      <defs>
        <linearGradient
          id="sh-api-gradient"
          x1="4"
          y1="2"
          x2="20"
          y2="22"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#FF6A3D" />
          <stop offset="0.55" stopColor="#F5397B" />
          <stop offset="1" stopColor="#C0339B" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#sh-api-gradient)" />
      <path d="M12 5.4l1.7 4.1 4.3 1.5-4.3 1.5-1.7 4.2-1.7-4.2L6 11l4.3-1.5z" fill="#fff" />
      <circle cx="18.2" cy="6.2" r="1.5" fill="#fff" opacity="0.85" />
    </svg>
  );
}

export function OpenAiIcon(props: BrandIconProps) {
  return (
    <svg {...frame} {...props}>
      <path
        fill="#10A37F"
        d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.023l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997z"
      />
    </svg>
  );
}

export function GeminiIcon(props: BrandIconProps) {
  return (
    <svg {...frame} {...props}>
      <defs>
        <linearGradient
          id="gemini-gradient"
          x1="3"
          y1="21"
          x2="21"
          y2="3"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#1C7DFF" />
          <stop offset="0.5" stopColor="#8E6BF6" />
          <stop offset="1" stopColor="#E06AD0" />
        </linearGradient>
      </defs>
      <path
        fill="url(#gemini-gradient)"
        d="M12 1.6c.55 5.2 3.6 8.4 10.4 10.4-6.8 2-9.85 5.2-10.4 10.4-.55-5.2-3.6-8.4-10.4-10.4C8.4 10 11.45 6.8 12 1.6z"
      />
    </svg>
  );
}

export function DeepSeekIcon(props: BrandIconProps) {
  return (
    <svg {...frame} {...props}>
      <rect x="1.6" y="1.6" width="20.8" height="20.8" rx="6.4" fill="#4D6BFE" />
      <path
        fill="#fff"
        d="M6.4 14.4c2.2-3.4 5-4.9 8.1-4.4 1.1.2 1.9.9 2.4 1.7.4.7 1 .3 1-.5 0-.9-.5-1.9-1.2-2.5.6.1 1.2.3 1.7.6-.3-1.6-1.6-2.9-3.2-3.3-1.9-.5-3.6.3-5 1.3-.9-.6-1.9-.8-2.9-.5.6.4 1 .9 1.2 1.5-2 .9-3.4 2.5-4 4.6-.4 1.4-.2 2.7.4 3.7.4-.9 1-1.6 1.5-2.2z"
      />
      <path
        fill="#fff"
        d="M9.6 12.3c1.4-.2 2.6.2 3.4 1.1.7.8 1 1.9.8 3-.1.8-.4 1.5-.9 2.1-1.2-.4-2.1-1.2-2.6-2.4-.4-1.1-.6-2.3-.7-3.8z"
        opacity="0.92"
      />
    </svg>
  );
}

export function OpenRouterIcon(props: BrandIconProps) {
  return (
    <svg {...frame} {...props}>
      <rect x="1.6" y="1.6" width="20.8" height="20.8" rx="6" fill="#12141A" />
      <path
        d="M6.2 9.1h4.9c1.3 0 2 .6 2.6 1.3l.7.9c.5.6.9.9 1.7.9h1.7"
        stroke="#fff"
        strokeWidth="1.7"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M6.2 15h4.9c1.3 0 2-.6 2.6-1.3l.7-.9c.5-.6.9-.9 1.7-.9h1.7"
        stroke="#8B93A7"
        strokeWidth="1.7"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M16.4 15.9l2.2-1.7-2.2-1.7v3.4z" fill="#fff" />
      <path d="M16.4 7.8l2.2 1.7-2.2 1.7V7.8z" fill="#8B93A7" />
    </svg>
  );
}

export function SiliconFlowIcon(props: BrandIconProps) {
  return (
    <svg {...frame} {...props}>
      <defs>
        <linearGradient
          id="siliconflow-gradient"
          x1="2"
          y1="3"
          x2="22"
          y2="21"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#5B8DEF" />
          <stop offset="1" stopColor="#7C4DFF" />
        </linearGradient>
      </defs>
      <rect x="1.6" y="1.6" width="20.8" height="20.8" rx="6.4" fill="url(#siliconflow-gradient)" />
      <path
        d="M5 15.6c1.4 0 2.3-1 3.1-2.4.8-1.4 1.6-3.1 3.1-3.1s2.3 1.3 3.1 2.6c.8 1.3 1.6 2.3 3 2.3"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M5 11.2c1.4 0 2.3-.8 3-1.9.5-.8 1-1.5 1.8-1.5"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
        opacity="0.7"
      />
    </svg>
  );
}

export function ClaudeIcon(props: BrandIconProps) {
  return (
    <svg {...frame} {...props}>
      <rect x="1.6" y="1.6" width="20.8" height="20.8" rx="6.4" fill="#D97757" />
      <g transform="translate(3.4 3.4) scale(0.7167)">
        <path
          fill="#fff"
          d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"
        />
      </g>
    </svg>
  );
}

export function GlmIcon(props: BrandIconProps) {
  return (
    <svg {...frame} {...props}>
      <rect x="1.6" y="1.6" width="20.8" height="20.8" rx="6.4" fill="#2F5BFF" />
      <path d="M7 7.4h10l-6.4 5.2H17v4H7l6.4-5.2H7z" fill="#fff" />
    </svg>
  );
}

export function GrokIcon(props: BrandIconProps) {
  return (
    <svg {...frame} {...props}>
      <rect x="1.6" y="1.6" width="20.8" height="20.8" rx="6.4" fill="#0B0C0E" />
      <g transform="translate(2.2 2.4) scale(0.8)">
        <path
          fill="#fff"
          d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815"
        />
      </g>
    </svg>
  );
}

export function QwenIcon(props: BrandIconProps) {
  return (
    <svg {...frame} {...props}>
      <rect x="1.6" y="1.6" width="20.8" height="20.8" rx="6.4" fill="#615CED" />
      <circle cx="11" cy="11" r="4.1" stroke="#fff" strokeWidth="1.9" fill="none" />
      <path d="M14.1 14.1l3.4 3.4" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="11" cy="11" r="1.4" fill="#fff" />
    </svg>
  );
}

export function GenericModelIcon(props: BrandIconProps) {
  return (
    <svg {...frame} {...props}>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" fill="none" />
      <path
        d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function TavilyIcon(props: BrandIconProps) {
  return (
    <svg {...frame} {...props}>
      <defs>
        <linearGradient
          id="tavily-gradient"
          x1="2"
          y1="2"
          x2="22"
          y2="22"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#3FBF9A" />
          <stop offset="1" stopColor="#18795E" />
        </linearGradient>
      </defs>
      <rect x="1.6" y="1.6" width="20.8" height="20.8" rx="6.4" fill="url(#tavily-gradient)" />
      <path
        d="M7 8.4h10M12 8.4v8.2"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="16.9" cy="16.4" r="1.5" fill="#fff" opacity="0.85" />
    </svg>
  );
}

export function BraveIcon(props: BrandIconProps) {
  return (
    <svg {...frame} {...props}>
      <path
        fill="#FB542B"
        d="M12 1.6l8.2 3.1v6.6c0 5.5-3.5 9.6-8.2 11.1-4.7-1.5-8.2-5.6-8.2-11.1V4.7z"
      />
      <path
        fill="#fff"
        d="M12 5.7l4.4 1.7c.3.1.5.4.4.7l-.5 2.5c-.4 1.9-2.1 3.2-4.3 3.2s-3.9-1.3-4.3-3.2l-.5-2.5c-.1-.3.1-.6.4-.7z"
        opacity="0.95"
      />
      <circle cx="9.9" cy="10.6" r="0.9" fill="#FB542B" />
      <circle cx="14.1" cy="10.6" r="0.9" fill="#FB542B" />
      <path d="M10.4 12.9h3.2l-1.6 1.6z" fill="#FB542B" />
    </svg>
  );
}

export function SerperIcon(props: BrandIconProps) {
  return (
    <svg {...frame} {...props}>
      <defs>
        <linearGradient
          id="serper-gradient"
          x1="2"
          y1="2"
          x2="22"
          y2="22"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#3B82F6" />
          <stop offset="1" stopColor="#F97316" />
        </linearGradient>
      </defs>
      <rect x="1.6" y="1.6" width="20.8" height="20.8" rx="6.4" fill="url(#serper-gradient)" />
      <path
        d="M16.6 8.6c-.9-1.1-2.5-1.7-4.2-1.4-2 .3-3.3 1.6-3.2 3 .1 1.3 1.3 1.9 3 2.1 2.1.3 3 .7 3 1.6 0 .9-1.1 1.5-2.6 1.4-1.4-.1-2.5-.7-3.2-1.6"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function ExaIcon(props: BrandIconProps) {
  return (
    <svg {...frame} {...props}>
      <rect x="1.6" y="1.6" width="20.8" height="20.8" rx="6.4" fill="#101014" />
      <circle cx="8.6" cy="8.6" r="1.9" fill="#fff" />
      <circle cx="15.4" cy="8.6" r="1.9" fill="#8E8EFF" />
      <circle cx="8.6" cy="15.4" r="1.9" fill="#8E8EFF" />
      <circle cx="15.4" cy="15.4" r="1.9" fill="#fff" />
    </svg>
  );
}

export function GoogleIcon(props: BrandIconProps) {
  return (
    <svg {...frame} {...props}>
      <path
        fill="#4285F4"
        d="M23.06 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h6.2a5.3 5.3 0 0 1-2.3 3.48v2.9h3.72c2.18-2 3.44-4.96 3.44-8.39z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.1 0 5.7-1.03 7.6-2.8l-3.72-2.88c-1.03.7-2.35 1.1-3.88 1.1-2.98 0-5.5-2-6.4-4.72H1.75v2.96A11.5 11.5 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.6 14.7a6.9 6.9 0 0 1 0-4.4V7.34H1.75a11.5 11.5 0 0 0 0 10.32L5.6 14.7z"
      />
      <path
        fill="#EA4335"
        d="M12 4.74c1.68 0 3.2.58 4.38 1.72l3.28-3.28C17.7 1.2 15.1 0 12 0A11.5 11.5 0 0 0 1.75 7.34L5.6 10.3C6.5 7.58 9.02 4.74 12 4.74z"
      />
    </svg>
  );
}

const AI_PROVIDER_ICONS: Record<AiProviderKey, (props: BrandIconProps) => JSX.Element> = {
  sh: ShApiIcon,
  openai: OpenAiIcon,
  gemini: GeminiIcon,
  deepseek: DeepSeekIcon,
  openrouter: OpenRouterIcon,
  siliconflow: SiliconFlowIcon
};

const MODEL_FAMILY_ICONS: Record<AiModelFamily, (props: BrandIconProps) => JSX.Element> = {
  openai: OpenAiIcon,
  claude: ClaudeIcon,
  gemini: GeminiIcon,
  deepseek: DeepSeekIcon,
  glm: GlmIcon,
  grok: GrokIcon,
  qwen: QwenIcon,
  generic: GenericModelIcon
};

const WEB_SEARCH_ICONS: Record<WebSearchServiceKey, (props: BrandIconProps) => JSX.Element> = {
  tavily: TavilyIcon,
  brave: BraveIcon,
  serper: SerperIcon,
  exa: ExaIcon,
  google: GoogleIcon
};

export function AiProviderIcon({
  provider,
  ...props
}: BrandIconProps & { provider: AiProviderKey }) {
  const Component = AI_PROVIDER_ICONS[provider];
  return <Component {...props} />;
}

export function AiModelFamilyIcon({
  family,
  ...props
}: BrandIconProps & { family: AiModelFamily }) {
  const Component = MODEL_FAMILY_ICONS[family];
  return <Component {...props} />;
}

export function WebSearchServiceIcon({
  service,
  ...props
}: BrandIconProps & { service: WebSearchServiceKey }) {
  const Component = WEB_SEARCH_ICONS[service];
  return <Component {...props} />;
}

export function ModelFamilyMark({
  modelId,
  className
}: {
  modelId: string | undefined | null;
  className?: string;
}) {
  const family = resolveAiModelFamily(modelId);
  return (
    <span className={['brand-mark', `brand-mark--${family}`, className].filter(Boolean).join(' ')}>
      <AiModelFamilyIcon family={family} className="brand-mark-glyph" />
    </span>
  );
}
