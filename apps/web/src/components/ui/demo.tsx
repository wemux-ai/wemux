import { useState } from 'react'
import { Switch } from './switch'

export default function SwitchCheckedDemo() {
  const [checked, setChecked] = useState(true)

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="scale-150 transform">
        <Switch
          label="Enabled"
          checked={checked}
          onToggle={() => setChecked((current) => !current)}
        />
      </div>
    </div>
  )
}
