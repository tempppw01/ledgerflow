import {
  BRAIN_ICON_URL,
  GLOBE_ICON_URL,
  INFO_ICON_URL
} from '../../../shared/config/brandAssets';

type InvestmentAiMessageDetailsProps = {
  reasoning?: string;
  webTrace?: string;
  auxiliaryInfo?: string;
};

function DetailBlock({
  title,
  description,
  iconSrc,
  variant,
  content
}: {
  title: string;
  description: string;
  iconSrc: string;
  variant: 'reasoning' | 'web' | 'news';
  content: string;
}) {
  return (
    <details className={`chat-reasoning-collapse investment-ai-message-detail is-${variant}`}>
      <summary>
        <span className="investment-ai-message-detail-leading">
          <span className="investment-ai-message-detail-icon" aria-hidden="true">
            <img src={iconSrc} alt="" />
          </span>
          <span className="investment-ai-message-detail-copy">
            <strong>{title}</strong>
            <small>{description}</small>
          </span>
        </span>
        <span className="investment-ai-message-detail-chevron" aria-hidden="true" />
      </summary>
      <pre>{content}</pre>
    </details>
  );
}

export function InvestmentAiMessageDetails({
  reasoning,
  webTrace,
  auxiliaryInfo
}: InvestmentAiMessageDetailsProps) {
  const hasReasoning = Boolean(reasoning?.trim());
  const hasWebTrace = Boolean(webTrace?.trim());
  const hasAuxiliaryInfo = Boolean(auxiliaryInfo?.trim());

  if (!hasReasoning && !hasWebTrace && !hasAuxiliaryInfo) {
    return null;
  }

  return (
    <div className="investment-ai-message-details">
      {hasReasoning ? (
        <DetailBlock
          title="思考过程"
          description="模型推理摘要"
          iconSrc={BRAIN_ICON_URL}
          variant="reasoning"
          content={reasoning!.trim()}
        />
      ) : null}
      {hasWebTrace ? (
        <DetailBlock
          title="联网过程"
          description="检索与核验状态"
          iconSrc={GLOBE_ICON_URL}
          variant="web"
          content={webTrace!.trim()}
        />
      ) : null}
      {hasAuxiliaryInfo ? (
        <DetailBlock
          title="相关资讯数据"
          description="新闻、政策与市场上下文"
          iconSrc={INFO_ICON_URL}
          variant="news"
          content={auxiliaryInfo!.trim()}
        />
      ) : null}
    </div>
  );
}
