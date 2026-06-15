import 'server-only';

import { listCustomers } from './customers';
import { listInvoices } from './invoices';

export type AccountStatus = 'Overdue' | 'Open' | 'Settled' | 'New';

export interface AccountInvoiceLine {
  id: number;
  number: string;
  status: string;
  isOverdue: boolean;
  issueDate: string;
  dueDate: string;
  total: number;
  amountPaid: number;
  balanceDue: number;
  currency: string;
}

export interface CustomerAccount {
  id: number;
  name: string;
  email: string | null;
  company: string | null;
  phone: string | null;
  billingAddress: string | null;
  status: AccountStatus;
  balance: number;
  totalBilled: number;
  totalPaid: number;
  overdue: number;
  invoiceCount: number;
  openCount: number;
  lastActivity: string | null;
  currency: string;
  invoices: AccountInvoiceLine[];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function listCustomerAccounts(defaultCurrency: string): Promise<CustomerAccount[]> {
  const [customers, invoices] = await Promise.all([listCustomers(), listInvoices()]);

  const byCustomer = new Map<number, typeof invoices>();
  for (const invoice of invoices) {
    const list = byCustomer.get(invoice.customer.id) ?? [];
    list.push(invoice);
    byCustomer.set(invoice.customer.id, list);
  }

  const accounts: CustomerAccount[] = customers.map((customer) => {
    const list = (byCustomer.get(customer.id) ?? []).filter((i) => i.status !== 'Void');
    const totalBilled = round2(list.reduce((acc, i) => acc + i.total, 0));
    const totalPaid = round2(list.reduce((acc, i) => acc + i.amountPaid, 0));
    const balance = round2(list.reduce((acc, i) => acc + i.balanceDue, 0));
    const overdue = round2(list.filter((i) => i.isOverdue).reduce((acc, i) => acc + i.balanceDue, 0));
    const openCount = list.filter((i) => i.balanceDue > 0).length;

    const lastActivity = list.reduce<string | null>((acc, i) => {
      if (!acc || new Date(i.updatedAt).getTime() > new Date(acc).getTime()) return i.updatedAt;
      return acc;
    }, null);

    let status: AccountStatus = 'New';
    if (overdue > 0) status = 'Overdue';
    else if (balance > 0) status = 'Open';
    else if (list.length > 0) status = 'Settled';

    const invoiceLines: AccountInvoiceLine[] = list
      .slice()
      .sort((a, b) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime())
      .map((i) => ({
        id: i.id,
        number: i.number,
        status: i.status,
        isOverdue: i.isOverdue,
        issueDate: i.issueDate,
        dueDate: i.dueDate,
        total: i.total,
        amountPaid: i.amountPaid,
        balanceDue: i.balanceDue,
        currency: i.currency,
      }));

    return {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      company: customer.company,
      phone: customer.phone,
      billingAddress: customer.billingAddress,
      status,
      balance,
      totalBilled,
      totalPaid,
      overdue,
      invoiceCount: list.length,
      openCount,
      lastActivity,
      currency: list[0]?.currency ?? defaultCurrency,
      invoices: invoiceLines,
    };
  });

  return accounts.sort((a, b) => {
    const aOverdue = a.overdue > 0 ? 1 : 0;
    const bOverdue = b.overdue > 0 ? 1 : 0;
    if (aOverdue !== bOverdue) return bOverdue - aOverdue;
    if (b.balance !== a.balance) return b.balance - a.balance;
    return a.name.localeCompare(b.name);
  });
}
