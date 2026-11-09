import { useRef } from 'react';
import type { ClipboardEvent, DragEvent, FormEvent } from 'react';
import { SMART_TRANSACTION_COMMANDS } from './workbenchTypes';

interface WorkbenchInputPanelProps {
  hasApiKey: boolean;
  submitting: boolean;
  canRecognize: boolean;
  textInput: string;
  imageDataUrls: string[];
  onTextChange: (value: string) => void;
  onApplyCommand: (prompt: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onSelectFiles: (files: File[]) => void;
  onRemoveImage: (index: number) => void;
  onClearImages: () => void;
}

export function WorkbenchInputPanel(props: WorkbenchInputPanelProps) {
  const {
    hasApiKey,
    submitting,
    canRecognize,
    textInput,
    imageDataUrls,
    onTextChange,
    onApplyCommand,
    onSubmit,
    onPaste,
    onDrop,
    onSelectFiles,
    onRemoveImage,
    onClearImages
  } = props;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  return (
    <section
      className="panel assistant-wb-input"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <header className="assistant-wb-section-head">
        <h3>第一步：输入或上传</h3>
        <small>支持文本、多图粘贴/拖拽</small>
      </header>

      <div className="chat-smart-command-row" aria-label="常用智能命令">
        {SMART_TRANSACTION_COMMANDS.map((item) => (
          <button
            key={item.key}
            type="button"
            className="chat-smart-command-chip"
            disabled={!hasApiKey || submitting}
            onClick={() => {
              onApplyCommand(item.prompt);
              window.requestAnimationFrame(() => textareaRef.current?.focus());
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {imageDataUrls.length > 0 ? (
        <div className="chat-image-strip">
          <div className="chat-thumb-list" aria-label="待发送图片列表">
            {imageDataUrls.map((url, idx) => (
              <div key={`pending-img-${idx}`} className="chat-thumb-item">
                <img src={url} alt={`待发送图片 ${idx + 1}`} className="chat-thumb" />
                <button
                  type="button"
                  className="chat-thumb-remove"
                  aria-label={`移除第 ${idx + 1} 张待发送图片`}
                  onClick={() => onRemoveImage(idx)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={onClearImages}>
            清空全部
          </button>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="chat-input-form">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="chat-file-input-hidden"
          aria-label="上传记账图片"
          aria-hidden="true"
          tabIndex={-1}
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files || []).filter((file) =>
              file.type.startsWith('image/')
            );
            onSelectFiles(files);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="chat-upload-btn"
          aria-label="上传记账图片"
          title="上传记账图片"
          disabled={!hasApiKey}
          onClick={() => fileInputRef.current?.click()}
        >
          📎
        </button>
        <textarea
          ref={textareaRef}
          rows={2}
          value={textInput}
          className="chat-input-textarea"
          aria-label="AI 记账输入"
          placeholder={hasApiKey ? '请输入交易内容，或粘贴图片后点击识别' : '请先配置 API Key'}
          disabled={!hasApiKey || submitting}
          onChange={(e) => onTextChange(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (canRecognize && !submitting) {
                const form = e.currentTarget.closest('form');
                form?.requestSubmit();
              }
            }
          }}
        />
        <button type="submit" className="primary" disabled={!canRecognize || submitting}>
          {submitting ? '识别中...' : '开始识别'}
        </button>
      </form>
    </section>
  );
}
