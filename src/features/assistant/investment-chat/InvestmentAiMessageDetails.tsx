type InvestmentAiMessageDetailsProps = {
  reasoning?: string;
  webTrace?: string;
  auxiliaryInfo?: string;
};

function DetailBlock({
  title,
  content
}: {
  title: string;
  content: string;
}) {
  return (
    <details className="chat-reasoning-collapse investment-ai-message-detail">
      <summary>{title}</summary>
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
      {hasReasoning ? <DetailBlock title="思考过程（点击展开）" content={reasoning!.trim()} /> : null}
      {hasWebTrace ? <DetailBlock title="联网过程（点击展开）" content={webTrace!.trim()} /> : null}
      {hasAuxiliaryInfo ? (
        <DetailBlock title="相关资讯数据（点击展开）" content={auxiliaryInfo!.trim()} />
      ) : null}
    </div>
  );
}
