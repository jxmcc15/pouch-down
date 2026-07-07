import { useEffect, useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

// Number that springs to its new value (odometer feel, no layout shift —
// pair with .num tabular figures).
export default function AnimatedNumber({ value, format = (v) => Math.round(v).toString(), className = '' }) {
  const mv = useMotionValue(value);
  const spring = useSpring(mv, { damping: 24, stiffness: 160 });
  const display = useTransform(spring, (v) => format(v));
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      spring.jump(value);
    }
    mv.set(value);
  }, [value, mv, spring]);

  return <motion.span className={`num ${className}`}>{display}</motion.span>;
}
