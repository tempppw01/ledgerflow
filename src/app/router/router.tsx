import { Navigate, createBrowserRouter } from 'react-router-dom';
import { DatabaseInitializationGate } from '../../features/database-provider/ui/DatabaseInitializationGate';
import { AppLayout } from '../../widgets/layout/AppLayout';
import {
  AboutPage,
  AssistantPage,
  BalanceChangesPage,
  CategoriesAccountsPage,
  DashboardPage,
  DatabaseSettingsPage,
  ExchangePage,
  FinancePage,
  FinancialAnalysisPage,
  GlobalMemoryPage,
  HelpPage,
  InvestmentsPage,
  RecycleBinPage,
  RepaymentManagementPage,
  SalaryToolsPage,
  SettingsPage,
  SmartBudgetPage,
  SubscriptionsPage,
  TransactionEditPage,
  TransactionsPage
} from './lazyPages';

export const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <DatabaseInitializationGate>
        <AppLayout />
      </DatabaseInitializationGate>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'transactions', element: <TransactionsPage /> },
      { path: 'transactions/new', element: <TransactionEditPage /> },
      { path: 'transactions/:id', element: <TransactionEditPage /> },
      { path: 'categories-accounts', element: <CategoriesAccountsPage /> },
      { path: 'balance-changes', element: <BalanceChangesPage /> },
      { path: 'recycle-bin', element: <RecycleBinPage /> },
      { path: 'subscriptions', element: <SubscriptionsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'about', element: <AboutPage /> },
      { path: 'assistant', element: <AssistantPage /> },
      { path: 'database-settings', element: <DatabaseSettingsPage /> },
      { path: 'exchange', element: <ExchangePage /> },
      { path: 'finance', element: <FinancePage /> },
      { path: 'investments', element: <InvestmentsPage /> },
      { path: 'investments/flow', element: <Navigate to="/investments" replace /> },
      { path: 'financial-analysis', element: <FinancialAnalysisPage /> },
      { path: 'salary-tools', element: <SalaryToolsPage /> },
      { path: 'repayment-management', element: <RepaymentManagementPage /> },
      { path: 'smart-budget', element: <SmartBudgetPage /> },
      { path: 'global-memory', element: <GlobalMemoryPage /> },
      { path: 'help', element: <HelpPage /> },
      { path: 'tags', element: <Navigate to="/categories-accounts" replace /> }
    ]
  }
]);
