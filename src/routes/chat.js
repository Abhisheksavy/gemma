import { Router } from 'express';
import { chat, health, metrics } from '../controllers/chatController.js';
import { auth } from '../middleware/auth.js';

const router = Router();

router.get('/health', health);      // public — used by load balancers
router.get('/metrics', auth, metrics); // protected if API_KEY is set
router.post('/chat', auth, chat);

export default router;
