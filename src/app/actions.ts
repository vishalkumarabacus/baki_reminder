"use server";

import prisma from "../lib/prisma";

function genToken() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// ================= AUTH =================
export async function loginOrRegister(phone: string, pin: string, isRegister: boolean, name?: string, bizName?: string) {
    let user = await prisma.user.findUnique({ where: { phone } });

    if (isRegister) {
        if (user) return { error: "Number already registered. Please Login." };
        user = await prisma.user.create({
            data: {
                phone,
                pin,
                auth_token: genToken(),
                name: name || "Shop Owner",
                business_name: bizName || "My Shop",
                lang: "en",
                reminder_template: "Namaste {name}, aapki {amount} ki payment {date} tak due hai. Kripya payment karein. - {biz}"
            }
        });
    } else {
        if (!user) return { error: "Account not found. Please Register." };
        if (user.pin !== pin) return { error: "Invalid PIN." };
        user = await prisma.user.update({
            where: { phone },
            data: { auth_token: genToken() }
        });
    }

    return {
        token: user.auth_token,
        user: { name: user.name, business_name: user.business_name, lang: user.lang, reminder_template: user.reminder_template }
    };
}

export async function getUser(token: string) {
    if (!token) return null;
    return await prisma.user.findFirst({ where: { auth_token: token } });
}

// ================= DATA FETCH =================
export async function getDashboardData(token: string) {
    const user = await prisma.user.findFirst({ where: { auth_token: token } });
    if (!user) return { error: "Unauthorized" };

    const customers = await prisma.customer.findMany({
        where: { user_id: user.id },
        orderBy: { created_at: 'desc' }
    });
    const entries = await prisma.entry.findMany({
        where: { user_id: user.id },
        orderBy: { created_at: 'desc' }
    });

    const notifications = await prisma.notification.findMany({
        where: { user_id: user.id },
        orderBy: { created_at: 'desc' },
        take: 50
    });

    return {
        customers,
        entries: entries.map((e: any) => ({ ...e, amount: String(e.amount) })),
        notifications,
        user: { name: user.name, bizName: user.business_name, lang: user.lang, template: user.reminder_template }
    };
}

export async function saveNotification(token: string, customer_id: string, message: string) {
    const user = await getUser(token);
    if (!user) return { error: "Unauthorized" };

    await prisma.notification.create({
        data: {
            id: "NOT-" + genToken(),
            user_id: user.id,
            customer_id,
            message,
        }
    });
    return { success: true };
}

// ================= CUSTOMERS =================
export async function addCustomer(token: string, name: string, phone: string, address: string, notes: string) {
    const user = await getUser(token);
    if (!user) return { error: "Unauthorized" };

    return await prisma.customer.create({
        data: {
            id: "CUST-" + genToken(),
            user_id: user.id,
            name, phone, address, notes
        }
    });
}

// ================= ENTRIES =================
export async function addEntry(token: string, customer_id: string, amount: number, type: "debit" | "credit", due_date: Date | null, note: string, transaction_date?: Date) {
    const user = await getUser(token);
    if (!user) return { error: "Unauthorized" };

    return await prisma.entry.create({
        data: {
            id: "ENT-" + genToken(),
            user_id: user.id,
            customer_id,
            amount,
            type,
            due_date: type === 'debit' ? due_date : null,
            status: type === 'credit' ? 'paid' : 'pending',
            note,
            ...(transaction_date ? { created_at: transaction_date } : {})
        }
    });
}

export async function updateEntryStatus(token: string, entry_id: string, status: "pending" | "paid", amount_received?: number) {
    const user = await getUser(token);
    if (!user) return { error: "Unauthorized" };

    const entry = await prisma.entry.findUnique({ where: { id: entry_id } });
    if (!entry || entry.user_id !== user.id) return { error: "Entry not found" };

    if (status === 'paid' && !amount_received) {
        // Full Mark as paid
        await prisma.entry.update({ where: { id: entry_id }, data: { status: 'paid' } });
        // Add credit entry automatically
        await prisma.entry.create({
            data: {
                id: "ENT-" + genToken(),
                user_id: user.id, customer_id: entry.customer_id,
                amount: entry.amount, type: 'credit', status: 'paid', note: "Full payment received"
            }
        });
    } else if (status === 'paid' && amount_received && amount_received < Number(entry.amount)) {
        // Partial payment
        const remaining = Number(entry.amount) - amount_received;

        // Mark original as paid but change amount to partial
        await prisma.entry.update({ where: { id: entry_id }, data: { status: 'paid', amount: amount_received } });

        // Add new debit for remaining
        await prisma.entry.create({
            data: {
                id: "ENT-" + genToken(), user_id: user.id, customer_id: entry.customer_id,
                amount: remaining, type: 'debit', status: 'pending', note: `Remaining (was ₹${entry.amount})`, due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            }
        });

        // Add credit for amount received
        await prisma.entry.create({
            data: {
                id: "ENT-" + genToken(), user_id: user.id, customer_id: entry.customer_id,
                amount: amount_received, type: 'credit', status: 'paid', note: "Partial payment received"
            }
        });
    }

    return { success: true };
}

// ================= SETTINGS =================
export async function updateSettings(token: string, lang: string, bizName: string, template: string) {
    const user = await getUser(token);
    if (!user) return { error: "Unauthorized" };

    await prisma.user.update({
        where: { id: user.id },
        data: { lang, business_name: bizName, reminder_template: template }
    });

    return { success: true };
}
