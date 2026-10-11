import { NextResponse } from 'next/server';
import dbConnect from '@/utils/db';
import User from '@/models/User';
import { verifyAuth } from '@/utils/authCheck';

const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
const NOWPAYMENTS_API_URL = 'https://api.nowpayments.io/v1';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export async function POST(req) {
  try {
    await dbConnect();

    const auth = await verifyAuth('user');
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: auth.status });
    }

    const user = auth.user;
    const { amount, currency = 'usd', payCurrency = 'usdttrc20' } = await req.json();

    // Validation
    const cleanAmount = Number(amount);
    if (isNaN(cleanAmount) || cleanAmount < 5) {
      return NextResponse.json({ 
        success: false, 
        message: 'সর্বনিম্ন ডিপোজিট $5!' 
      }, { status: 400 });
    }

    // ✅ NowPayments API call
    const response = await fetch(`${NOWPAYMENTS_API_URL}/invoice`, {
      method: 'POST',
      headers: {
        'x-api-key': NOWPAYMENTS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        price_amount: cleanAmount,
        price_currency: currency,
        pay_currency: payCurrency,
        order_id: `DEP-${user.uid}-${Date.now()}`,
        order_description: `Deposit for ${user.uid}`,
        ipn_callback_url: `${APP_URL}/api/nowpayments/webhook`,
        success_url: `${APP_URL}/wallet?payment=success`,
        cancel_url: `${APP_URL}/deposit?payment=cancelled`,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('NowPayments API error:', data);
      return NextResponse.json({ 
        success: false, 
        message: data.message || 'NowPayments API error' 
      }, { status: 400 });
    }

    return NextResponse.json({ 
      success: true, 
      invoice_url: data.invoice_url,
      invoice_id: data.id,
      order_id: data.order_id
    }, { status: 200 });

  } catch (error) {
    console.error('Create Invoice Error:', error);
    return NextResponse.json({ 
      success: false, 
      message: 'সার্ভার ত্রুটি!' 
    }, { status: 500 });
  }
}