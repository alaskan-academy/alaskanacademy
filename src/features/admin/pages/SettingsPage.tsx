import { DashboardLayout } from "@/components/DashboardLayout";
import { ContasAnunciosTab } from "@/features/editores/components/ContasAnunciosTab";

export default function SettingsPage() {
  return (
    <DashboardLayout title="Configurações">
      <ContasAnunciosTab />
    </DashboardLayout>
  );
}
