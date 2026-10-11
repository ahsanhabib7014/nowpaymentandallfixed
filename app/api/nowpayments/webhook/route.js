// import { NextResponse } from 'next/server';
// import crypto from 'crypto';
// import dbConnect from '@/utils/db';
// import Deposit from '@/models/Deposit';
// import User from '@/models/User';
// import Setting from '@/models/Setting';

// const IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET;

// // ✅ Recursive sort — NOWPayments official নিয়ম
// function sortObject(obj) {
//   if (typeof obj !== 'object' || obj === null) return obj;
//   if (Array.isArray(obj)) return obj.map(sortObject);
//   return Object.keys(obj)
//     .sort()
//     .reduce((result, key) => {
//       result[key] = sortObject(obj[key]);
//       return result;
//     }, {});
// }

// // ✅ IPN signature verify (recursive sort সহ)
// function verifyIPN(body, signature) {
//   try {
//     const sortedBody = JSON.stringify(sortObject(body));
//     const hmac = crypto.createHmac('sha512', IPN_SECRET);
//     hmac.update(sortedBody);
//     const expectedSig = hmac.digest('hex');

//     // timing-safe compare
//     const a = Buffer.from(expectedSig, 'utf8');
//     const b = Buffer.from(signature, 'utf8');
//     if (a.length !== b.length) return false;
//     return crypto.timingSafeEqual(a, b);
//   } catch (err) {
//     console.error('verifyIPN error:', err);
//     return false;
//   }
// }

// export async function POST(req) {
//   try {
//     await dbConnect();

//     // ✅ 1. Signature header check
//     const signature = req.headers.get('x-nowpayments-sig');
//     if (!signature) {
//       console.error('❌ No signature header');
//       return NextResponse.json({ success: false, message: 'No signature' }, { status: 401 });
//     }

//     // ✅ 2. Body parse
//     let body;
//     try {
//       body = await req.json();
//     } catch (e) {
//       return NextResponse.json({ success: false, message: 'Invalid JSON' }, { status: 400 });
//     }

//     // ✅ 3. Signature verify
//     if (!verifyIPN(body, signature)) {
//       console.error('❌ Invalid IPN signature');
//       return NextResponse.json({ success: false, message: 'Invalid signature' }, { status: 401 });
//     }

//     // ✅ 4. Status extract
//     const {
//       payment_status,
//       price_amount,
//       actually_paid,
//       order_id,
//       payment_id,
//       pay_address,
//     } = body;

//     console.log('✅ IPN received:', {
//       payment_status,
//       order_id,
//       payment_id,
//       price_amount,
//       actually_paid,
//     });

//     // ✅ 5. শুধু 'finished' status-এ balance add
//     if (payment_status !== 'finished') {
//       // partially_paid, waiting, confirming, failed — সব বাদ
//       return NextResponse.json(
//         { success: true, message: `Status: ${payment_status}` },
//         { status: 200 }
//       );
//     }

//     // ✅ 6. order_id validate
//     if (!order_id || typeof order_id !== 'string') {
//       return NextResponse.json({ success: false, message: 'Invalid order_id' }, { status: 400 });
//     }

//     // ✅ 7. order_id format: DEP-<uid>-<timestamp>
//     // uid-তে hyphen থাকলেও সঠিকভাবে extract করবে
//     const prefix = 'DEP-';
//     if (!order_id.startsWith(prefix)) {
//       return NextResponse.json({ success: false, message: 'Invalid order_id prefix' }, { status: 400 });
//     }

//     const rest = order_id.slice(prefix.length); // <uid>-<timestamp>
//     const lastDash = rest.lastIndexOf('-');
//     if (lastDash === -1) {
//       return NextResponse.json({ success: false, message: 'Invalid order_id format' }, { status: 400 });
//     }

//     const userUid = rest.slice(0, lastDash); // uid (hyphen থাকলেও কাজ করবে)
//     const timestamp = rest.slice(lastDash + 1);

//     if (!userUid || !timestamp) {
//       return NextResponse.json({ success: false, message: 'Invalid order_id parts' }, { status: 400 });
//     }

//     // ✅ 8. Duplicate check
//     const txnId = `NOW-${payment_id}`;
//     const existing = await Deposit.findOne({ transactionId: txnId });
//     if (existing) {
//       console.log('⚠️ Duplicate IPN — ignoring');
//       return NextResponse.json({ success: true, message: 'Already processed' }, { status: 200 });
//     }

//     // ✅ 9. Rate fetch
//     const rateSetting = await Setting.findOne({ key: 'usdToBdtRate' });
//     const USD_TO_BDT_RATE = Number(rateSetting?.value) || 120;

//     // ✅ 10. Amount নির্বাচন — actually_paid বেশি নিরাপদ
//     // price_amount = invoice-এ যা চাওয়া হয়েছিল
//     // actually_paid = গ্রাহক আসলে যা পাঠিয়েছে
//     // finished status-এ actually_paid ≈ price_amount হয়ে থাকে
//     const paidUsd = Number(actually_paid) > 0
//       ? Number(actually_paid)
//       : Number(price_amount);

//     if (!paidUsd || paidUsd <= 0) {
//       return NextResponse.json({ success: false, message: 'Invalid amount' }, { status: 400 });
//     }

//     const bdtAmount = Math.round(paidUsd * USD_TO_BDT_RATE);

//     // ✅ 11. User exists কিনা চেক
//     const userExists = await User.findOne({ uid: userUid });
//     if (!userExists) {
//       console.error('❌ User not found:', userUid);
//       return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
//     }

//     // ✅ 12. Deposit record তৈরি
//     await Deposit.create({
//       uid: userUid,
//       amount: bdtAmount,
//       originalAmount: paidUsd,
//       originalCurrency: 'USD',
//       exchangeRate: USD_TO_BDT_RATE,
//       method: 'NowPayments',
//       senderNumber: pay_address || 'NOW',
//       transactionId: txnId,
//       status: 'approved',
//       adminNote: `Auto-approved via NowPayments (${body.pay_currency || 'crypto'})`,
//     });

//     // ✅ 13. Balance + turnover atomic update
//     await User.findOneAndUpdate(
//       { uid: userUid },
//       {
//         $inc: {
//           balance: bdtAmount,
//           turnover: bdtAmount,
//         },
//       }
//     );

//     console.log(`✅ Balance added: ৳${bdtAmount} to ${userUid}`);

//     return NextResponse.json({ success: true }, { status: 200 });

//   } catch (error) {
//     console.error('IPN Webhook Error:', error);
//     return NextResponse.json({ success: false }, { status: 500 });
//   }
// }

// ..................................................

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import dbConnect from '@/utils/db';
import Deposit from '@/models/Deposit';
import User from '@/models/User';
import Setting from '@/models/Setting';

const IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET;

// ✅ Recursive sort — NOWPayments official নিয়ম
function sortObject(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(sortObject);
  return Object.keys(obj).sort().reduce((result, key) => {
    result[key] = sortObject(obj[key]);
    return result;
  }, {});
}

function verifyIPN(body, signature) {
  try {
    const sortedBody = JSON.stringify(sortObject(body));
    const hmac = crypto.createHmac('sha512', IPN_SECRET);
    hmac.update(sortedBody);
    const expectedSig = hmac.digest('hex');
    const a = Buffer.from(expectedSig, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (err) {
    console.error('verifyIPN error:', err);
    return false;
  }
}

// ✅ NowPayments status → Deposit status mapping
function mapPaymentStatus(npStatus) {
  switch (npStatus) {
    case 'finished':
      return 'approved';       // ✅ ব্যালেন্স যোগ হবে
    case 'partially_paid':
      return 'partial';        // ⚠️ আংশিক পেমেন্ট
    case 'failed':
    case 'refunded':
    case 'expired':
      return 'rejected';       // ❌ বাতিল
    case 'waiting':
    case 'confirming':
    case 'confirmed':
    case 'sending':
    default:
      return 'pending';        // ⏳ এখনো প্রসেস হচ্ছে
  }
}

export async function POST(req) {
  try {
    await dbConnect();

    // ১. Signature header
    const signature = req.headers.get('x-nowpayments-sig');
    if (!signature) {
      return NextResponse.json({ success: false, message: 'No signature' }, { status: 401 });
    }

    // ২. Body parse
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return NextResponse.json({ success: false, message: 'Invalid JSON' }, { status: 400 });
    }

    // ৩. Signature verify
    if (!verifyIPN(body, signature)) {
      console.error('❌ Invalid IPN signature');
      return NextResponse.json({ success: false, message: 'Invalid signature' }, { status: 401 });
    }

    // ৪. তথ্য extract
    const {
      payment_status,
      price_amount,
      actually_paid,
      order_id,
      payment_id,
      pay_address,
      pay_currency,
    } = body;

    console.log('✅ IPN received:', {
      payment_status,
      order_id,
      payment_id,
      price_amount,
      actually_paid,
    });

    // ৫. order_id validate
    if (!order_id || typeof order_id !== 'string' || !order_id.startsWith('DEP-')) {
      return NextResponse.json({ success: false, message: 'Invalid order_id' }, { status: 400 });
    }

    // ৬. uid extract (hyphen-safe)
    const rest = order_id.slice(4); // DEP- বাদ
    const lastDash = rest.lastIndexOf('-');
    if (lastDash === -1) {
      return NextResponse.json({ success: false, message: 'Invalid order_id format' }, { status: 400 });
    }
    const userUid = rest.slice(0, lastDash);
    const txnId = `NOW-${payment_id}`;

    // ৭. Status map
    const depositStatus = mapPaymentStatus(payment_status);

    // ৮. Rate fetch
    const rateSetting = await Setting.findOne({ key: 'usdToBdtRate' });
    const USD_TO_BDT_RATE = Number(rateSetting?.value) || 120;

    const paidUsd = Number(actually_paid) > 0 ? Number(actually_paid) : Number(price_amount) || 0;
    const bdtAmount = Math.round(paidUsd * USD_TO_BDT_RATE);

    // ৯. Deposit record খুঁজুন বা তৈরি করুন
    let deposit = await Deposit.findOne({ transactionId: txnId });

    if (!deposit) {
      // প্রথমবার — নতুন record তৈরি
      deposit = await Deposit.create({
        uid: userUid,
        amount: bdtAmount,
        originalAmount: paidUsd,
        originalCurrency: 'USD',
        exchangeRate: USD_TO_BDT_RATE,
        method: 'NowPayments',
        senderNumber: pay_address || 'NOW',
        transactionId: txnId,
        status: depositStatus,
        adminNote: `NowPayments: ${payment_status} (${pay_currency || 'crypto'})`,
      });
    } else {
      // ✅ আগের record আছে — status আপডেট
      const wasAlreadyApproved = deposit.status === 'approved';
      const nowApproved = depositStatus === 'approved';

      // ✅ যদি আগে approved হয়ে থাকে, তাহলে balance দ্বিতীয়বার যোগ করব না
      if (wasAlreadyApproved && nowApproved) {
        console.log('⚠️ Already approved — ignoring duplicate');
        return NextResponse.json({ success: true, message: 'Already processed' }, { status: 200 });
      }

      deposit.status = depositStatus;
      deposit.amount = bdtAmount;
      deposit.originalAmount = paidUsd;
      deposit.adminNote = `NowPayments: ${payment_status} (${pay_currency || 'crypto'})`;
      await deposit.save();
    }

    // ১০. ✅ শুধু finished/approved হলে balance + turnover যোগ
    if (depositStatus === 'approved') {
      // ইউজার আছে কিনা চেক
      const user = await User.findOne({ uid: userUid });
      if (!user) {
        console.error('❌ User not found:', userUid);
        return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
      }

      // Balance atomic update
      await User.findOneAndUpdate(
        { uid: userUid },
        {
          $inc: {
            balance: bdtAmount,
            turnover: bdtAmount,
          },
        }
      );

      console.log(`✅ Balance added: ৳${bdtAmount} to ${userUid}`);
    }

    // ১১. ✅ pending / rejected / partial হলেও কিছুই করব না — শুধু record থাকবে
    return NextResponse.json({ success: true }, { status: 200 });

  } catch (error) {
    console.error('IPN Webhook Error:', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}