import { BaseJob } from '../../../src/jobs/BaseJob.js';

/**
 * Notification Job
 * 
 * Handles sending notifications through various channels
 * including email, SMS, Slack, webhooks, and push notifications.
 */
export class NotificationJob extends BaseJob {
  constructor() {
    super('NotificationJob');
  }

  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    // Validate required fields
    this.validatePayload(payload, ['type']);

    const { type, recipients, subject, message, template, channel, url, priority = 'normal' } = payload;

    try {
      console.log(` Sending ${type} notification${recipients ? ` to ${recipients.length} recipients` : ''}`);

      // Simulate notification sending time based on type
      const sendTime = this.getSendTime(type, recipients?.length || 1);
      await this.simulateNotificationSending(sendTime, type);

      // Send the notification
      const result = await this.sendNotification(type, {
        recipients,
        subject,
        message,
        template,
        channel,
        url,
        priority,
        payload: payload.payload
      });

      console.log(` ${type} notification sent successfully`);

      return this.createSuccessResult({
        type,
        recipients: recipients?.length || 1,
        subject,
        channel,
        priority,
        sendTimeMs: sendTime,
        messageId: result.messageId,
        deliveryStatus: result.deliveryStatus,
        estimatedDelivery: result.estimatedDelivery,
        cost: result.cost
      });

    } catch (error) {
      console.error(` ${type} notification failed:`, error);
      throw new Error(`Notification failed for ${type}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getSendTime(type: string, recipientCount: number): number {
    const baseTime = {
      'email': 500,
      'sms': 300,
      'slack': 200,
      'webhook': 400,
      'push': 250,
      'discord': 300,
      'teams': 350
    }[type] || 400;

    // Add time based on recipient count
    const recipientTime = Math.min(recipientCount * 50, 2000); // Max 2 seconds for recipients
    
    return baseTime + recipientTime;
  }

  private async simulateNotificationSending(timeMs: number, type: string): Promise<void> {
    const steps = [
      'Validating recipients',
      'Preparing message content',
      'Connecting to service',
      'Sending notification',
      'Confirming delivery'
    ];

    const stepTime = timeMs / steps.length;

    for (let i = 0; i < steps.length; i++) {
      console.log(`    ${steps[i]}...`);
      await new Promise(resolve => setTimeout(resolve, stepTime));
    }
  }

  private async sendNotification(
    type: string,
    options: {
      recipients?: string[];
      subject?: string;
      message?: string;
      template?: string;
      channel?: string;
      url?: string;
      priority?: string;
      payload?: any;
    }
  ): Promise<{
    messageId: string;
    deliveryStatus: string;
    estimatedDelivery: string;
    cost: number;
  }> {
    const messageId = this.generateMessageId();
    
    switch (type) {
      case 'email':
        return {
          messageId,
          deliveryStatus: 'queued',
          estimatedDelivery: '2-5 minutes',
          cost: (options.recipients?.length || 1) * 0.001 // $0.001 per email
        };

      case 'sms':
        return {
          messageId,
          deliveryStatus: 'sent',
          estimatedDelivery: '30 seconds',
          cost: (options.recipients?.length || 1) * 0.05 // $0.05 per SMS
        };

      case 'slack':
        // Simulate Slack API call
        if (!options.channel) {
          throw new Error('Slack channel is required');
        }
        return {
          messageId,
          deliveryStatus: 'delivered',
          estimatedDelivery: 'immediate',
          cost: 0 // Free for most Slack usage
        };

      case 'webhook':
        // Simulate webhook call
        if (!options.url) {
          throw new Error('Webhook URL is required');
        }
        
        // Simulate potential webhook failures
        if (Math.random() < 0.05) { // 5% failure rate
          throw new Error('Webhook endpoint returned 500 error');
        }
        
        return {
          messageId,
          deliveryStatus: 'delivered',
          estimatedDelivery: 'immediate',
          cost: 0
        };

      case 'push':
        return {
          messageId,
          deliveryStatus: 'sent',
          estimatedDelivery: '1-2 minutes',
          cost: (options.recipients?.length || 1) * 0.0001 // $0.0001 per push
        };

      case 'discord':
        return {
          messageId,
          deliveryStatus: 'delivered',
          estimatedDelivery: 'immediate',
          cost: 0
        };

      case 'teams':
        return {
          messageId,
          deliveryStatus: 'delivered',
          estimatedDelivery: 'immediate',
          cost: 0
        };

      default:
        throw new Error(`Unsupported notification type: ${type}`);
    }
  }

  private generateMessageId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return `msg_${timestamp}_${random}`;
  }

  getJobId(payload?: Record<string, any>): string | undefined {
    if (!payload) return undefined;

    // Create ID based on notification type and key identifiers
    const { type, recipients, channel, url, subject } = payload;
    const identifier = recipients?.join(',') || channel || url || subject || 'no-identifier';
    const content = `${this.jobName}-${type}-${identifier}-${Date.now()}`;
    return require('crypto').createHash('sha1').update(content).digest('hex');
  }
}