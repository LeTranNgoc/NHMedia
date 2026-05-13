import type { FastifyInstance } from 'fastify';
import type { Db } from 'mongodb';

export async function healthRoutes(app: FastifyInstance, { db }: { db: Db }): Promise<void> {
  app.get('/health', async (_request, reply) => {
    let mongoStatus = 'disconnected';
    try {
      await db.command({ ping: 1 });
      mongoStatus = 'connected';
    } catch {
      mongoStatus = 'disconnected';
    }

    return reply.status(200).send({
      ok: true,
      mongo: mongoStatus,
      uptime: Math.floor(process.uptime()),
    });
  });
}
