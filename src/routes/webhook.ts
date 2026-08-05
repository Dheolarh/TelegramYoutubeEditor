import { Router, Request, Response } from 'express';

export const webhookRouter = Router();

/**
 * GET /webhook
 * Verification endpoint required by Meta WhatsApp Cloud API setup.
 */
webhookRouter.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'my_secret_verify_token';

  if (mode && token) {
    if (mode === 'subscribe' && token === verifyToken) {
      console.log('✅ WhatsApp Webhook verified successfully!');
      return res.status(200).send(challenge);
    } else {
      console.warn('❌ Webhook verification failed. Token mismatch.');
      return res.sendStatus(403);
    }
  }

  return res.sendStatus(400);
});

/**
 * POST /webhook
 * Message receiver endpoint for incoming WhatsApp messages and notifications.
 */
webhookRouter.post('/', (req: Request, res: Response) => {
  const body = req.body;

  if (body.object === 'whatsapp_business_account') {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (message) {
      const from = message.from; // Sender WhatsApp Phone Number
      const type = message.type;

      console.log(`📩 Received WhatsApp message from [${from}] of type [${type}]`);

      if (type === 'text') {
        const textBody = message.text?.body;
        console.log(`💬 Message content: "${textBody}"`);
      }
    }

    // Always acknowledge Meta webhooks with a 200 OK
    return res.status(200).send('EVENT_RECEIVED');
  }

  return res.sendStatus(404);
});
