import { DashboardLayout } from '@/components/DashboardLayout';
import { FinanceiroNav } from '@/features/financeiro/components/FinanceiroNav';

export default function FinanceiroNotasFiscaisPage() {
  return (
    <DashboardLayout title="Financeiro">
      <FinanceiroNav />
      <div />
    </DashboardLayout>
  );
}
