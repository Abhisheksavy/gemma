import { Router } from 'express';
import { chat, health } from '../controllers/chatController.js';

const router = Router();

router.post('/chat', chat);
router.get('/health', health);

export default router;
