import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function GET() {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 465,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER, // reminder@flowbee.io
        pass: process.env.SMTP_PASS,
      },
    });

    const info = await transporter.sendMail({
      from: `"Flowbee Test" <${process.env.SMTP_USER}>`,
      to: 'vertexsolutionsptb@gmail.com',
      subject: '🚀 Test Email: Flowbee SMTP is Working!',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; border: 2px solid #2563eb; border-radius: 10px;">
          <h2 style="color: #2563eb;">Congratulations!</h2>
          <p>Your SMTP mail system (<strong>reminder@flowbee.io</strong>) is working perfectly without any issues.</p>
          <p>Sent to: <strong>vertexsolutionsptb@gmail.com</strong></p>
          <p>Timestamp: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
        </div>
      `,
    });

    return NextResponse.json({
      success: true,
      message: 'Test email sent successfully to vertexsolutionsptb@gmail.com!',
      messageId: info.messageId,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        details: error,
      },
      { status: 500 }
    );
  }
}