import { useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { FinanceiroNav } from '@/features/financeiro/components/FinanceiroNav';
import { MapaCustos } from '@/features/financeiro/components/MapaCustos';
import { PrevistoRealizado } from '@/features/financeiro/components/PrevistoRealizado';

/**
 * Onde o dinheiro está indo, e onde dá para cortar.
 *
 * Esta tela olha para trás. As duas perguntas dela são "qual categoria pesa
 * mais" e "o que fugiu do padrão neste mês" — as duas decisões de corte. O que
 * olha para frente (saldo, o que ainda vai sair) mora no Caixa & DRE.
 *
 * Os dois blocos viviam empilhados no fim do Caixa, que acumulou seis blocos e
 * deixou de responder qualquer pergunta direito.
 */

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export default function FinanceiroGastosPage() {
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth());

  function avancar() {
    if (mes === 11) { setMes(0); setAno(a => a + 1); }
    else setMes(m => m + 1);
  }
  function voltar() {
    if (mes === 0) { setMes(11); setAno(a => a - 1); }
    else setMes(m => m - 1);
  }

  return (
    <DashboardLayout title="Gastos" hideFilters>
      <FinanceiroNav />

      {/* O seletor governa só o "Fugiu do padrão" — o mapa mostra sempre os
          últimos seis meses, porque a leitura dele é a tendência e não o mês. */}
      <div className="flex items-center gap-2 mb-4">
        <Button variant="ghost" size="icon" onClick={voltar} aria-label="Mês anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-lg font-semibold w-32 text-center">{MESES[mes]} {ano}</span>
        <Button variant="ghost" size="icon" onClick={avancar} aria-label="Próximo mês">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-6">
        <MapaCustos meses={6} />
        <PrevistoRealizado ano={ano} mes={mes} />
      </div>
    </DashboardLayout>
  );
}
