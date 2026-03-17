"use server";

import prisma from "../lib/prisma";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "baki_super_secret_key_2026";

function genToken() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function generateJwt(userId: number) {
    return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
}

// ================= AUTH =================
export async function loginOrRegister(phone: string, pin: string, isRegister: boolean, name?: string, bizName?: string) {
    let user = await prisma.user.findUnique({ where: { phone } });

    if (isRegister) {
        if (user) return { error: "Number already registered. Please Login." };
        const hashedPin = await bcrypt.hash(pin, 10);
        user = await prisma.user.create({
            data: {
                phone,
                pin: hashedPin,
                auth_token: genToken(),
                name: name || "Shop Owner",
                business_name: bizName || "My Shop",
                lang: "en",
                reminder_template: "Namaste {name}, aapki {amount} ki payment {date} tak due hai. Kripya payment karein. - {biz}"
            }
        });
        const token = generateJwt(user.id);
        user = await prisma.user.update({ where: { id: user.id }, data: { auth_token: token } });
    } else {
        if (!user) return { error: "Account not found. Please Register." };
        
        const isValid = await bcrypt.compare(pin, user.pin);
        
        // Temporary fallback to plaintext migration if they had a plaintext PIN in the database
        if (!isValid && user.pin !== pin) {
            return { error: "Invalid PIN." };
        } else if (!isValid && user.pin === pin) {
            // They logged in with the old plaintext PIN, let's hash it and update the DB!
            const newHashedPin = await bcrypt.hash(pin, 10);
            await prisma.user.update({ where: { phone }, data: { pin: newHashedPin } });
        }

        const token = generateJwt(user.id);
        user = await prisma.user.update({
            where: { phone },
            data: { auth_token: token }
        });
    }

    return {
        token: user.auth_token,
        user: { name: user.name, business_name: user.business_name, lang: user.lang, reminder_template: user.reminder_template }
    };
}

export async function getUser(token: string) {
    if (!token) return null;
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: number };
        return await prisma.user.findUnique({ where: { id: decoded.userId } });
    } catch {
        // Fallback for older tokens that aren't JWTs
        return await prisma.user.findFirst({ where: { auth_token: token } });
    }
}

// ================= DATA FETCH =================
export async function getDashboardData(token: string) {
    const user = await getUser(token);
    if (!user) return { error: "Unauthorized" };

    const customers = await prisma.customer.findMany({
        where: { user_id: user.id },
        orderBy: { created_at: 'desc' }
    });
    
    // Instead of sending all entries to the client, we query and aggregate them on the server!
    const entries = await prisma.entry.findMany({
        where: { user_id: user.id },
        select: { customer_id: true, amount: true, type: true, status: true, due_date: true }
    });

    let dueToday = 0;
    let overdue = 0;
    let totalPending = 0;
    const balances: Record<string, number> = {};
    const statuses: Record<string, string> = {};

    customers.forEach(c => balances[c.id] = 0);

    entries.forEach(e => {
        const amt = Number(e.amount) || 0;
        if (e.type === 'debit') {
            balances[e.customer_id] = (balances[e.customer_id] || 0) + amt;
            if (e.status !== 'paid') {
                const d = new Date(e.due_date || new Date());
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                d.setHours(0, 0, 0, 0);
                if (d.getTime() < today.getTime()) overdue += amt;
                if (d.getTime() === today.getTime()) dueToday += amt;
            }
        }
        if (e.type === 'credit') {
            balances[e.customer_id] = (balances[e.customer_id] || 0) - amt;
        }
    });

    customers.forEach(c => {
        const b = balances[c.id] || 0;
        if (b > 0) totalPending += b;
        if (b <= 0) statuses[c.id] = 'paid';
        else statuses[c.id] = 'pending';
    });

    if (overdue > totalPending) overdue = totalPending;
    if (dueToday > totalPending) dueToday = totalPending;

    const recentEntries = await prisma.entry.findMany({
        where: { user_id: user.id },
        orderBy: { created_at: 'desc' },
        take: 10
    });

    const notifications = await prisma.notification.findMany({
        where: { user_id: user.id },
        orderBy: { created_at: 'desc' },
        take: 50
    });

    return {
        customers,
        calculations: { totalPending, dueToday, overdue, balances, statuses },
        entries: recentEntries.map((e: any) => ({ ...e, amount: String(e.amount) })),
        notifications,
        user: { name: user.name, bizName: user.business_name, lang: user.lang, template: user.reminder_template }
    };
}

export async function getCustomerEntries(token: string, customer_id: string) {
    const user = await getUser(token);
    if (!user) return { error: "Unauthorized" };

    const entries = await prisma.entry.findMany({
        where: { user_id: user.id, customer_id },
        orderBy: { created_at: 'desc' }
    });
    return entries.map((e: any) => ({ ...e, amount: String(e.amount) }));
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
