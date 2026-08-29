import type { TaskStatus } from '@shared/types'
import { linearIconColors } from '../lib/status-colors'

const SIZE = 14
const STROKE_WIDTH = 1.5
const RADIUS = 6
const CENTER = 7

type TaskStatusIconProps = {
  status: TaskStatus
  size?: number
  className?: string
}

export function TaskStatusIcon({ status, size = SIZE, className }: TaskStatusIconProps) {
  const colors = linearIconColors[status]

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label={status}
    >
      {status === 'backlog' && <BacklogIcon colors={colors} />}
      {status === 'todo' && <TodoIcon colors={colors} />}
      {status === 'in_progress' && <InProgressIcon colors={colors} />}
      {status === 'in_review' && <InReviewIcon colors={colors} />}
      {status === 'done' && <DoneIcon colors={colors} />}
      {status === 'blocked' && <BlockedIcon colors={colors} />}
      {status === 'cancelled' && <CancelledIcon colors={colors} />}
    </svg>
  )
}

function BacklogIcon({ colors }: { colors: { stroke: string; fill: string } }) {
  return (
    <g>
      <circle cx={CENTER} cy={CENTER} r={RADIUS - 0.5} stroke={colors.stroke} strokeWidth={STROKE_WIDTH} fill="none" />
      <circle cx={CENTER} cy={CENTER} r={2} fill={colors.stroke} />
    </g>
  )
}

function TodoIcon({ colors }: { colors: { stroke: string; fill: string } }) {
  return (
    <circle
      cx={CENTER}
      cy={CENTER}
      r={RADIUS - 0.5}
      stroke={colors.stroke}
      strokeWidth={STROKE_WIDTH}
      fill="none"
    />
  )
}

function InProgressIcon({ colors }: { colors: { stroke: string; fill: string } }) {
  return (
    <g>
      <circle cx={CENTER} cy={CENTER} r={RADIUS - 0.5} stroke={colors.stroke} strokeWidth={STROKE_WIDTH} fill="none" />
      <path
        d={`M ${CENTER} ${CENTER - (RADIUS - 0.5)} A ${RADIUS - 0.5} ${RADIUS - 0.5} 0 1 1 ${CENTER} ${CENTER + (RADIUS - 0.5)}`}
        fill={colors.fill}
      />
    </g>
  )
}

function InReviewIcon({ colors }: { colors: { stroke: string; fill: string } }) {
  return (
    <g>
      <circle cx={CENTER} cy={CENTER} r={RADIUS - 0.5} stroke={colors.stroke} strokeWidth={STROKE_WIDTH} fill="none" />
      <circle cx={CENTER} cy={CENTER} r={2.5} fill={colors.fill} />
    </g>
  )
}

function DoneIcon({ colors }: { colors: { stroke: string; fill: string } }) {
  return (
    <g>
      <circle cx={CENTER} cy={CENTER} r={RADIUS - 0.5} fill={colors.fill} />
      <path
        d="M 4.5 7 L 6.2 9 L 9.5 5.5"
        stroke="white"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </g>
  )
}

function BlockedIcon({ colors }: { colors: { stroke: string; fill: string } }) {
  return (
    <g>
      <circle cx={CENTER} cy={CENTER} r={RADIUS - 0.5} stroke={colors.stroke} strokeWidth={STROKE_WIDTH} fill="none" />
      <line x1={4.5} y1={CENTER} x2={9.5} y2={CENTER} stroke={colors.stroke} strokeWidth={1.5} strokeLinecap="round" />
    </g>
  )
}

function CancelledIcon({ colors }: { colors: { stroke: string; fill: string } }) {
  return (
    <g>
      <circle cx={CENTER} cy={CENTER} r={RADIUS - 0.5} stroke={colors.stroke} strokeWidth={STROKE_WIDTH} fill="none" />
      <path
        d="M 5 5 L 9 9 M 9 5 L 5 9"
        stroke={colors.stroke}
        strokeWidth={1.3}
        strokeLinecap="round"
      />
    </g>
  )
}
