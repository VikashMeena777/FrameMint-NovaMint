/**
 * Cashfree Payment Gateway — server-side client
 * Uses Cashfree Payment Gateway API (standard checkout)
 *
 * Flow:
 * 1. Backend creates an order → gets payment_session_id
 * 2. Frontend redirects user to Cashfree checkout with session ID
 * 3. User pays → redirected back to our return URL
 * 4. Backend verifies payment status
 * 5. Webhook confirms payment → upgrades user plan
 */

import crypto from 'crypto';

/* ---------- config ---------- */

const CF_APP_ID = process.env.CASHFREE_APP_ID!;
const CF_SECRET_KEY = process.env.CASHFREE_SECRET_KEY!;
const CF_WEBHOOK_SECRET = process.env.CASHFREE_WEBHOOK_SECRET || '';
const CF_ENV = process.env.NEXT_PUBLIC_CASHFREE_ENV || 'sandbox';

const BASE_URL =
  CF_ENV === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';

const API_VERSION = '2023-08-01'; // Stable PG API version

/* ---------- types ---------- */

export interface CashfreeOrderRequest {
  orderId: string;
  orderAmount: number;
  orderCurrency?: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  returnUrl: string;
  notifyUrl?: string;
  orderMeta?: {
    plan: string;
    userId: string;
  };
}

export interface CashfreeOrderResponse {
  cf_order_id: string;
  order_id: string;
  payment_session_id: string;
  order_status: string;
  order_amount: number;
}

export interface CashfreePaymentStatus {
  cf_order_id: string;
  order_id: string;
  order_amount: number;
  order_status: 'PAID' | 'ACTIVE' | 'EXPIRED' | 'TERMINATED' | 'PARTIALLY_PAID';
  order_currency: string;
  cf_payment_id?: string;
  payment_status?: string;
  payment_method?: string;
}

/* ---------- API helpers ---------- */

async function cashfreeRequest<T>(
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: Record<string, unknown>
): Promise<T> {
  const url = `${BASE_URL}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': CF_APP_ID,
      'x-client-secret': CF_SECRET_KEY,
      'x-api-version': API_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[Cashfree] ${method} ${path} → ${res.status}`, errText);
    throw new Error(`Cashfree API error: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

/* ---------- public API ---------- */

/**
 * Create a Cashfree order and get a payment_session_id
 * The frontend will use this session ID to launch checkout
 */
export async function createOrder(req: CashfreeOrderRequest): Promise<CashfreeOrderResponse> {
  return cashfreeRequest<CashfreeOrderResponse>('/orders', 'POST', {
    order_id: req.orderId,
    order_amount: req.orderAmount,
    order_currency: req.orderCurrency || 'INR',
    customer_details: {
      customer_id: req.orderMeta?.userId || req.orderId,
      customer_name: req.customerName,
      customer_email: req.customerEmail,
      customer_phone: req.customerPhone,
    },
    order_meta: {
      return_url: req.returnUrl,
      notify_url: req.notifyUrl,
      payment_methods: 'cc,dc,upi,nb,app,paylater',
    },
    order_tags: req.orderMeta
      ? { plan: req.orderMeta.plan, user_id: req.orderMeta.userId }
      : undefined,
  });
}

/**
 * Get the status of an existing order
 */
export async function getOrderStatus(orderId: string): Promise<CashfreePaymentStatus> {
  return cashfreeRequest<CashfreePaymentStatus>(`/orders/${orderId}`);
}

/**
 * Verify Cashfree webhook signature (HMAC-SHA256)
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  if (!CF_WEBHOOK_SECRET) {
    console.error('[Cashfree] CRITICAL: CASHFREE_WEBHOOK_SECRET not configured');
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', CF_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('base64');

  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);

  // timingSafeEqual throws if lengths differ — guard against it
  if (sigBuf.length !== expectedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(sigBuf, expectedBuf);
}

/**
 * Generate a unique order ID with timestamp
 */
export function generateOrderId(userId: string, plan: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `FM_${plan.toUpperCase()}_${ts}_${rand}`;
}
