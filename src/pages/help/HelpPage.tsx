import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

const guideSections = [
  {
    number: '01',
    key: 'flow',
    to: '/transactions?quickAdd=1&entry=help'
  },
  {
    number: '02',
    key: 'accounts',
    to: '/categories-accounts'
  },
  {
    number: '03',
    key: 'plan',
    to: '/repayment-management'
  },
  {
    number: '04',
    key: 'backup',
    to: '/database-settings'
  }
] as const;

const faqItems = [
  {
    questionKey: 'databaseStatusQuestion',
    answerKey: 'databaseStatusAnswer'
  },
  {
    questionKey: 'sqliteLocationQuestion',
    answerKey: 'sqliteLocationAnswer'
  },
  {
    questionKey: 'aiQuestion',
    answerKey: 'aiAnswer'
  },
  {
    questionKey: 'shortcutsQuestion',
    answerKey: 'shortcutsAnswer'
  }
] as const;

export function HelpPage() {
  const { t } = useTranslation();
  const sections = guideSections.map((section) => ({
    ...section,
    title: t(`help.sections.${section.key}.title`),
    description: t(`help.sections.${section.key}.description`),
    steps: [1, 2, 3].map((step) =>
      t(`help.sections.${section.key}.steps.${step}`)
    ),
    action: t(`help.sections.${section.key}.action`)
  }));

  return (
    <main className="help-page vi-page" aria-labelledby="help-title">
      <header className="help-header">
        <p className="help-eyebrow">{t('help.eyebrow')}</p>
        <h1 id="help-title">{t('help.title')}</h1>
        <p>{t('help.description')}</p>
      </header>
      <nav className="help-jump-nav" aria-label={t('help.jumpNavAria')}>
        {sections.map((section) => (
          <a key={section.number} href={`#guide-${section.number}`}>
            {section.number} {section.title}
          </a>
        ))}
        <a href="#help-faq">{t('help.faqLink')}</a>
      </nav>
      <section className="help-start-strip" aria-label={t('help.startAria')}>
        <div>
          <strong>{t('help.startTitle')}</strong>
          <span>{t('help.startDescription')}</span>
        </div>
        <Link to="/transactions?quickAdd=1&entry=help">{t('help.startAction')}</Link>
      </section>
      <div className="help-guide-list">
        {sections.map((section) => (
          <article
            id={`guide-${section.number}`}
            className="help-guide-section"
            key={section.number}
          >
            <span className="help-guide-number">{section.number}</span>
            <div className="help-guide-content">
              <h2>{section.title}</h2>
              <p>{section.description}</p>
              <ol>
                {section.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <Link to={section.to}>
                {section.action} <span aria-hidden="true">›</span>
              </Link>
            </div>
          </article>
        ))}
      </div>
      <section id="help-faq" className="help-faq" aria-labelledby="help-faq-title">
        <header>
          <p className="help-eyebrow">{t('help.faq.eyebrow')}</p>
          <h2 id="help-faq-title">{t('help.faq.title')}</h2>
        </header>
        {faqItems.map((item) => (
          <details key={item.questionKey}>
            <summary>{t(`help.faq.${item.questionKey}`)}</summary>
            <p>{t(`help.faq.${item.answerKey}`)}</p>
          </details>
        ))}
      </section>
    </main>
  );
}
