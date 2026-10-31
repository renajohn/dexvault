import fs from 'fs';
import path from 'path';
import { Request, Response } from 'express';
import multer from 'multer';
import scoreFilesService, { filesDir, ScoreFilesError } from '../services/scoreFilesService';
import logger from '../logger';

const fail = (res: Response, error: unknown): void => {
  if (error instanceof ScoreFilesError) { res.status(error.status).json({ error: error.message }); return; }
  logger.error('Score files:', error);
  res.status(500).json({ error: (error as Error).message });
};
const id = (value: unknown) => parseInt(String(value), 10);

// A scan of a thick book in greys runs past 100 MB.
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = filesDir();
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const name = path.basename(file.originalname, path.extname(file.originalname)).replace(/[^a-zA-Z0-9_-]/g, '_');
      cb(null, `score_${(req as Request).params.id}_${Date.now()}_${name}.pdf`);
    },
  }),
  limits: { fileSize: 400 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname)) cb(null, true);
    else cb(new ScoreFilesError('A PDF, please', 400));
  },
});

const scoreFilesController = {
  uploadMiddleware: (req: Request, res: Response, next: () => void) => {
    upload.single('file')(req, res, (error: unknown) => (error ? fail(res, error) : next()));
  },
  // GET: its PDFs
  list: async (req: Request, res: Response): Promise<void> => {
    try { res.json(await scoreFilesService.list(id(req.params.id))); } catch (error) { fail(res, error); }
  },
  // POST multipart { file, label? }: a PDF added
  add: async (req: Request, res: Response): Promise<void> => {
    const file = req.file as Express.Multer.File | undefined;
    if (!file) { res.status(400).json({ error: 'No file sent' }); return; }
    // Its name as the browser gave it, without the characters the disk's name lost.
    const label = typeof req.body?.label === 'string' && req.body.label.trim()
      ? req.body.label : path.basename(file.originalname, path.extname(file.originalname)).replace(/_+/g, ' ');
    try { res.status(201).json(await scoreFilesService.add(id(req.params.id), file.filename, label)); } catch (error) { fail(res, error); }
  },
  // PUT { label?, isDefault? }
  change: async (req: Request, res: Response): Promise<void> => {
    try { res.json(await scoreFilesService.change(id(req.params.id), id(req.params.fileId), req.body || {})); } catch (error) { fail(res, error); }
  },
  remove: async (req: Request, res: Response): Promise<void> => {
    try { res.json(await scoreFilesService.remove(id(req.params.id), id(req.params.fileId))); } catch (error) { fail(res, error); }
  },
  // GET: the PDF, opened in the browser
  pdf: async (req: Request, res: Response): Promise<void> => {
    try {
      const { path: file, name } = await scoreFilesService.pathOf(id(req.params.id), id(req.params.fileId));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
      fs.createReadStream(file).pipe(res);
    } catch (error) { fail(res, error); }
  },
};

export default scoreFilesController;
