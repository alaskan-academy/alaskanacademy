import { DashboardLayout } from "@/components/DashboardLayout";
import { ContasAnunciosTab } from "@/components/editores/ContasAnunciosTab";

export default function SettingsPage() {
  return (
    <DashboardLayout title="Configurações">
      <ContasAnunciosTab />
    </DashboardLayout>
  );
}
