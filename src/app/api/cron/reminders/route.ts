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
  const authHeader = request.headers.get('authorization');

  const isValidHeader = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isValidQuery = secretKey === process.env.CRON_SECRET;
  const isDev = process.env.NODE_ENV === 'development';

  // Allow bypass in local dev or if valid CRON_SECRET is passed via header or URL query param
  if (process.env.CRON_SECRET && !isValidHeader && !isValidQuery && !isDev) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  // Fetch only non-completed tasks
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('*')
    .not('status', 'in', '("Completed","Cancelled","Resolved")');

  if (error || !tasks) {
    return NextResponse.json({ error: error?.message }, { status: 500 });
  }

  const emailsToSend: Promise<any>[] = [];

  for (const item of tasks) {
    // Ensure vertexsolutionsptb@gmail.com is strictly included in all alerts
    const rawEmails: string[] = item.participants || [];
    const emails = Array.from(new Set([...rawEmails, 'vertexsolutionsptb@gmail.com']));

    const isEvent = item.type === 'event';
    const isTask = item.type === 'task' || !item.type;

    // 1. EVENT: Night before reminder at 9:00 PM (21:00)
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
              <p>${item.description || ''}</p>
            </div>
          `,
        })
      );
    }

    // 2. EVENT: Same-day morning reminder at 9:30 AM
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
              <p>${item.description || ''}</p>
            </div>
          `,
        })
      );
    }

    // 3. TASK / EVENT: Start Time exact notification
    if (item.start_date === todayStr && item.start_time) {
      const [startH, startM] = item.start_time.split(':').map(Number);
      if (currentHour === startH && Math.abs(currentMinute - startM) <= 15) {
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
                <p>${item.description || ''}</p>
              </div>
            `,
          })
        );
      }
    }

    // 4. TASK / EVENT: Due Time notification
    if (item.due_date === todayStr && item.due_time) {
      const [dueH, dueM] = item.due_time.split(':').map(Number);
      if (currentHour === dueH && Math.abs(currentMinute - dueM) <= 15) {
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
                <p>${item.description || ''}</p>
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
    processed: tasks.length,
    emailsDispatched: emailsToSend.length,
    results 
  });
}