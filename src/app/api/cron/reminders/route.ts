import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 465,
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER, // reminder@flowbee.io
    pass: process.env.SMTP_PASS,
  },
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secretKey = searchParams.get('key');
  const isTest = searchParams.get('test') === 'true';
  const authHeader = request.headers.get('authorization');

  const isValidHeader = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isValidQuery = secretKey === process.env.CRON_SECRET;
  const isDev = process.env.NODE_ENV === 'development';

  if (process.env.CRON_SECRET && !isValidHeader && !isValidQuery && !isDev) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // 🇮🇳 Calculate exact Indian Standard Time (IST - UTC+5:30)
  const nowUtc = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const now = new Date(nowUtc.getTime() + istOffset);

  const todayStr = now.toISOString().split('T')[0];
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const currentHour = now.getUTCHours();
  const currentMinute = now.getUTCMinutes();
  const currentTotalMinutes = currentHour * 60 + currentMinute;

  // 🧪 Quick Manual Test
  if (isTest) {
    try {
      const testInfo = await transporter.sendMail({
        from: `"Flowbee Reminders" <${process.env.SMTP_USER}>`,
        to: 'vertexsolutionsptb@gmail.com',
        subject: '✅ Flowbee SMTP Test Success',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #10b981; border-radius: 8px;">
            <h2 style="color: #10b981;">SMTP & Cron Working!</h2>
            <p>Your custom SMTP (<strong>${process.env.SMTP_USER}</strong>) is actively connected.</p>
            <p>Current Server IST: <strong>${now.toUTCString()}</strong></p>
          </div>
        `,
      });
      return NextResponse.json({ success: true, message: 'Test email sent successfully!', testInfo });
    } catch (err: any) {
      return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
  }

  // Fetch active categories
  const { data: categories } = await supabase.from('departments').select('*');
  const deptMap = new Map((categories || []).map((d) => [d.id, d.name]));

  // Fetch all non-completed tasks
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('*')
    .not('status', 'in', '("Completed","Cancelled","Resolved")');

  if (error || !tasks) {
    return NextResponse.json({ error: error?.message }, { status: 500 });
  }

  const emailsToSend: Promise<any>[] = [];

  // 🌙 1. 11:59 PM (23:50 to 23:59 IST) -> നാളത്തെ ടാസ്‌കുകളുടെയും ഇവന്റുകളുടെയും ഫുൾ അജണ്ട സമ്മറി
  if (currentHour === 23 && currentMinute >= 50) {
    const tomorrowItems = tasks.filter((t) => {
      const effDate = t.start_date || t.due_date;
      return effDate === tomorrowStr || t.due_date === tomorrowStr;
    });

    if (tomorrowItems.length > 0) {
      // Collect all unique participant emails across tomorrow's tasks
      const allTomorrowEmails = new Set<string>(['vertexsolutionsptb@gmail.com']);
      tomorrowItems.forEach((t) => {
        (t.participants || []).forEach((p: string) => allTomorrowEmails.add(p));
      });

      const tomorrowHtmlRows = tomorrowItems.map((item) => `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 10px; font-weight: bold; color: ${item.type === 'event' ? '#7c3aed' : '#2563eb'};">
            ${item.type === 'event' ? '📹 Event' : '📝 Task'}
          </td>
          <td style="padding: 10px; font-weight: 600; color: #1e293b;">
            ${item.title}
            ${item.meet_link ? `<br><a href="${item.meet_link}" style="color: #7c3aed; font-size: 11px; text-decoration: underline;">Join Google Meet</a>` : ''}
          </td>
          <td style="padding: 10px; font-size: 12px; color: #64748b;">
            ${deptMap.get(item.department_id) || 'General'}
          </td>
          <td style="padding: 10px; font-size: 12px; font-weight: 600; color: #0f172a;">
            ${item.start_time || '00:00'} ${item.due_time ? `- ${item.due_time}` : ''}
          </td>
          <td style="padding: 10px; font-size: 11px; font-weight: bold; color: ${item.priority === 'Crit' ? '#e11d48' : '#d97706'};">
            ${item.priority}
          </td>
        </tr>
      `).join('');

      emailsToSend.push(
        transporter.sendMail({
          from: `"Flowbee Timeline" <${process.env.SMTP_USER}>`,
          to: Array.from(allTomorrowEmails).join(','),
          subject: `📅 Tomorrow's Agenda & Schedule - ${tomorrowStr}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
              <div style="border-bottom: 2px solid #2563eb; padding-bottom: 12px; margin-bottom: 20px;">
                <h2 style="color: #0f172a; margin: 0; font-size: 20px;">Tomorrow's Tasks & Events Agenda</h2>
                <p style="color: #64748b; margin: 4px 0 0 0; font-size: 13px;">Date: <strong>${tomorrowStr}</strong> • Sent at 11:59 PM IST</p>
              </div>

              <p style="font-size: 14px; color: #334155; margin-bottom: 16px;">Here is the full breakdown of activities scheduled for tomorrow:</p>

              <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; margin-bottom: 20px;">
                <thead>
                  <tr style="background-color: #f8fafc; border-bottom: 2px solid #cbd5e1; color: #475569;">
                    <th style="padding: 10px;">Type</th>
                    <th style="padding: 10px;">Title</th>
                    <th style="padding: 10px;">Category</th>
                    <th style="padding: 10px;">Time</th>
                    <th style="padding: 10px;">Priority</th>
                  </tr>
                </thead>
                <tbody>
                  ${tomorrowHtmlRows}
                </tbody>
              </table>

              <div style="background-color: #f1f5f9; padding: 12px; border-radius: 8px; font-size: 12px; color: #64748b; text-align: center;">
                Generated by <strong>Project Timeline Hub</strong> • Flowbee Automated Dispatcher
              </div>
            </div>
          `,
        })
      );
    }
  }

  // 🔔 2. Individual Task/Event Exact Time Reminders
  for (const item of tasks) {
    const rawEmails: string[] = item.participants || [];
    const emails = Array.from(new Set([...rawEmails, 'vertexsolutionsptb@gmail.com']));

    const isEvent = item.type === 'event';
    const isTask = item.type === 'task' || !item.type;

    // EVENT: തലേദിവസം രാത്രി 9:00 PM (21:00)
    if (isEvent && item.due_date === tomorrowStr && currentHour === 21 && currentMinute <= 15) {
      emailsToSend.push(
        transporter.sendMail({
          from: `"Flowbee Reminders" <${process.env.SMTP_USER}>`,
          to: emails.join(','),
          subject: `Reminder: Upcoming Event Tomorrow - ${item.title}`,
          html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
              <h2 style="color: #7c3aed;">Upcoming Event Tomorrow</h2>
              <p><strong>Event:</strong> ${item.title}</p>
              <p><strong>Date:</strong> ${item.due_date}</p>
              <p><strong>Time:</strong> ${item.due_time || 'All Day'}</p>
              ${item.meet_link ? `<p><a href="${item.meet_link}" style="background:#7c3aed;color:white;padding:8px 16px;border-radius:6px;text-decoration:none;display:inline-block;">Join Google Meet</a></p>` : ''}
              <div style="margin-top: 10px;">${item.description || ''}</div>
            </div>
          `,
        })
      );
    }

    // EVENT: അതേ ദിവസം രാവിലെ 9:30 AM
    if (isEvent && item.due_date === todayStr && currentHour === 9 && currentMinute >= 25 && currentMinute <= 40) {
      emailsToSend.push(
        transporter.sendMail({
          from: `"Flowbee Reminders" <${process.env.SMTP_USER}>`,
          to: emails.join(','),
          subject: `Event Today: ${item.title}`,
          html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
              <h2 style="color: #7c3aed;">Event Happening Today</h2>
              <p><strong>Event:</strong> ${item.title}</p>
              <p><strong>Time:</strong> ${item.due_time || 'All Day'}</p>
              ${item.meet_link ? `<p><a href="${item.meet_link}" style="background:#7c3aed;color:white;padding:8px 16px;border-radius:6px;text-decoration:none;display:inline-block;">Join Google Meet</a></p>` : ''}
              <div style="margin-top: 10px;">${item.description || ''}</div>
            </div>
          `,
        })
      );
    }

    // TASK / EVENT: Start Time
    if (item.start_date === todayStr && item.start_time) {
      const [startH, startM] = item.start_time.split(':').map(Number);
      const taskStartMinutes = startH * 60 + startM;
      if (Math.abs(currentTotalMinutes - taskStartMinutes) <= 10) {
        emailsToSend.push(
          transporter.sendMail({
            from: `"Flowbee Reminders" <${process.env.SMTP_USER}>`,
            to: emails.join(','),
            subject: `Starting Now: ${item.title}`,
            html: `
              <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                <h2 style="color: #2563eb;">Starting Notice</h2>
                <p><strong>Title:</strong> ${item.title}</p>
                <p><strong>Start Time:</strong> ${item.start_time}</p>
                ${item.meet_link ? `<p><a href="${item.meet_link}" style="background:#2563eb;color:white;padding:8px 16px;border-radius:6px;text-decoration:none;display:inline-block;">Join Meeting</a></p>` : ''}
              </div>
            `,
          })
        );
      }
    }

    // TASK / EVENT: Due Time
    if (item.due_date === todayStr && item.due_time) {
      const [dueH, dueM] = item.due_time.split(':').map(Number);
      const taskDueMinutes = dueH * 60 + dueM;
      if (Math.abs(currentTotalMinutes - taskDueMinutes) <= 10) {
        emailsToSend.push(
          transporter.sendMail({
            from: `"Flowbee Reminders" <${process.env.SMTP_USER}>`,
            to: emails.join(','),
            subject: `Due Now: ${item.title}`,
            html: `
              <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                <h2 style="color: #e11d48;">Due Notice</h2>
                <p><strong>Title:</strong> ${item.title}</p>
                <p><strong>Due Time:</strong> ${item.due_time}</p>
                <p><strong>Priority:</strong> ${item.priority}</p>
              </div>
            `,
          })
        );
      }
    }
  }

  const results = await Promise.allSettled(emailsToSend);
  return NextResponse.json({ 
    success: true, 
    istTime: `${currentHour}:${currentMinute < 10 ? '0' : ''}${currentMinute}`,
    processed: tasks.length,
    emailsDispatched: emailsToSend.length,
    results 
  });
}