import { AnimatePresence, motion } from 'framer-motion'
import type { Toast } from '../../lab/useLabWiring'

export function LabToast({ toast }: { toast: Toast | null }) {
  return (
    <div aria-live="polite" className="toast-region">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            className={`toast ${toast.bad ? 'bad' : ''}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.2 }}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
