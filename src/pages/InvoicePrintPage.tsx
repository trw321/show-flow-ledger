import { Link, useParams } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, Printer, Mail } from 'lucide-react';
import { useData } from '@/lib/DataContext';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { invoiceTotal } from '@/lib/invoices';

/**
 * One invoice as a page of its own: white, plain, nothing around it, so the
 * phone's Print — or Save as PDF — gives exactly the invoice.
 */

const money = (n: number) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const long = (iso: string) => format(parseISO(iso), 'MMMM d, yyyy');

export default function InvoicePrintPage() {
  const { id } = useParams();
  const { data, authReady } = useData();
  const { prefs } = useUserPrefs();
  const invoice = (data.invoices ?? []).find(v => v.id === id);
  const from = prefs.invoiceFrom ?? {};

  if (!invoice) {
    return (
      <div className="min-h-screen bg-white p-6 text-black">
        <p className="text-sm">{authReady ? 'That invoice is not here.' : 'Loading…'}</p>
        <Link to="/invoices" className="mt-3 inline-block text-sm underline">Back to invoices</Link>
      </div>
    );
  }

  const total = invoiceTotal(invoice);
  const mail = invoice.clientEmail
    ? `mailto:${invoice.clientEmail}?subject=${encodeURIComponent(`Invoice ${invoice.number}`)}&body=${encodeURIComponent(
      `Hi,\n\nInvoice ${invoice.number} for ${money(total)}${invoice.dueDate ? `, due ${long(invoice.dueDate)}` : ''}, is attached.\n\nThank you,\n${from.name ?? from.business ?? ''}`,
    )}`
    : undefined;

  return (
    <div className="min-h-screen bg-white text-black">
      {/* The tools, which do not print. */}
      <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3 print:hidden">
        <Link to="/invoices" className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-black"><ArrowLeft size={15} /> Invoices</Link>
        <span className="flex-1" />
        {mail && <a href={mail} className="inline-flex items-center gap-1 rounded border border-neutral-300 px-3 py-1.5 text-sm"><Mail size={14} /> Email</a>}
        <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1 rounded bg-black px-3 py-1.5 text-sm text-white"><Printer size={14} /> Print / Save PDF</button>
      </div>
      {mail && <p className="px-4 pt-2 text-[11px] text-neutral-500 print:hidden">Save as PDF first, then attach it to the email.</p>}

      <article className="mx-auto max-w-2xl px-6 py-8 text-[13px] leading-relaxed print:p-0">
        <header className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">INVOICE</h1>
            <div className="mt-3 text-neutral-700">
              {from.business && <p className="font-semibold text-black">{from.business}</p>}
              {from.name && <p className={from.business ? '' : 'font-semibold text-black'}>{from.name}</p>}
              {from.address && <p>{from.address}</p>}
              {from.email && <p>{from.email}</p>}
              {from.phone && <p>{from.phone}</p>}
            </div>
          </div>
          <div className="text-right text-neutral-700">
            <p className="text-lg font-semibold text-black">{invoice.number}</p>
            <p>Issued {long(invoice.issueDate)}</p>
            {invoice.dueDate && <p>Due {long(invoice.dueDate)}</p>}
            {invoice.status === 'paid' && <p className="mt-1 font-bold text-black">PAID</p>}
          </div>
        </header>

        <section className="mt-8">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Bill to</p>
          <p className="font-semibold">{invoice.client}</p>
          {invoice.clientAddress && <p className="text-neutral-700">{invoice.clientAddress}</p>}
          {invoice.clientEmail && <p className="text-neutral-700">{invoice.clientEmail}</p>}
        </section>

        <table className="mt-8 w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-black text-left text-[11px] uppercase tracking-wider">
              <th className="py-2 pr-2 font-semibold">Description</th>
              <th className="py-2 px-2 text-right font-semibold">Qty</th>
              <th className="py-2 px-2 text-right font-semibold">Rate</th>
              <th className="py-2 pl-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l, i) => (
              <tr key={i} className="border-b border-neutral-200 align-top">
                <td className="py-2 pr-2">{l.description}</td>
                <td className="py-2 px-2 text-right tabular-nums">{l.quantity ?? ''}</td>
                <td className="py-2 px-2 text-right tabular-nums">{l.rate !== undefined ? money(l.rate) : ''}</td>
                <td className="py-2 pl-2 text-right tabular-nums">{money(Number(l.amount) || 0)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="pt-4 pr-2 text-right font-semibold">Total</td>
              <td className="pt-4 pl-2 text-right text-lg font-bold tabular-nums">{money(total)}</td>
            </tr>
          </tfoot>
        </table>

        {invoice.notes && (
          <section className="mt-8">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Notes</p>
            <p className="whitespace-pre-wrap">{invoice.notes}</p>
          </section>
        )}
      </article>
    </div>
  );
}
