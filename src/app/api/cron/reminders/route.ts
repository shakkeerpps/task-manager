import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import nodemailer from 'nodemailer';

// നിങ്ങളുടെ സ്വന്തം SMTP കോൺഫിഗറേഷൻ
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 465,
  secure: Number(process.env.SMTP_PORT) === 465, // 465 ആണെങ്കിൽ true, 587 ആണെങ്കിൽ false
  auth: {
    user: process.env.SMTP_USER, // reminder@flowbee.io
    pass: process.env.SMTP_PASS,
  },
});

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('*')
    .not('status', 'in', '("Completed","Cancelled","Resolved")');

  if (error || !tasks) {
    return NextResponse.json({ error: error?.message }, { status: 500 });
  }

  const emailsToSend: Promise<any>[] = [];

  for (const item of tasks) {
    const emails: string[] = item.participants || [];
    if (emails.length === 0) continue;

    const isEvent = item.type === 'event';
    const isTask = item.type === 'task' || !item.type;

    // EVENT: തലേദിവസം രാത്രി 9:00 PM (21:00) റിമൈൻഡർ
    if (isEvent && item.due_date === tomorrowStr && currentHour === 21 && currentMinute <= 15) {
      emailsToSend.push(
        transporter.sendMail({
          from: `"Flowbee Reminders" <${process.env.SMTP_USER}>`,
          to: emails.join(','),
          subject: `Reminder: Upcoming Event Tomorrow - ${item.title}`,
          html: `
            <div style="font-family: sans-serif; padding: 20px;">
              <h2>Reminder: Upcoming Event Tomorrow</h2>
              <p><strong>Event:</strong> ${item.title}</p>
              <p><strong>Date:</strong> ${item.due_date}</p>
              <p><strong>Time:</strong> ${item.due_time || 'All Day'}</p>
              ${item.meet_link ? `<p><a href="${item.meet_link}" style="background:#2563eb;color:white;padding:8px 16px;border-radius:6px;text-decoration:none;">Join Google Meet</a></p>` : ''}
              <p>${item.description || ''}</p>
            </div>
          `,
        })
      );
    }

    // EVENT: അതേ ദിവസം രാവിലെ 9:30 AM റിമൈൻഡർ
    if (isEvent && item.due_date === todayStr && currentHour === 9 && currentMinute >= 25 && currentMinute <= 40) {
      emailsToSend.push(
        transporter.sendMail({
          from: `"Flowbee Reminders" <${process.env.SMTP_USER}>`,
          to: emails.join(','),
          subject: `Event Today: ${item.title}`,
          html: `
            <div style="font-family: sans-serif; padding: 20px;">
              <h2>Event Happening Today</h2>
              <p><strong>Event:</strong> ${item.title}</p>
              <p><strong>Time:</strong> ${item.due_time || 'All Day'}</p>
              ${item.meet_link ? `<p><a href="${item.meet_link}" style="background:#2563eb;color:white;padding:8px 16px;border-radius:6px;text-decoration:none;">Join Google Meet</a></p>` : ''}
              <p>${item.description || ''}</p>
            </div>
          `,
        })
      );
    }

    // TASK: Due Time എത്തുമ്പോൾ ഉള്ള റിമൈൻഡർ
    if (isTask && item.due_date === todayStr && item.due_time) {
      const [dueH, dueM] = item.due_time.split(':').map(Number);
      if (currentHour === dueH && Math.abs(currentMinute - dueM) <= 15) {
        emailsToSend.push(
          transporter.sendMail({
            from: `"Flowbee Reminders" <${process.env.SMTP_USER}>`,
            to: emails.join(','),
            subject: `Task Due Now: ${item.title}`,
            html: `
              <div style="font-family: sans-serif; padding: 20px;">
                <h2>Task Due Notice</h2>
                <p><strong>Task:</strong> ${item.title}</p>
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

  await Promise.allSettled(emailsToSend);
  return NextResponse.json({ success: true, processed: tasks.length });
}