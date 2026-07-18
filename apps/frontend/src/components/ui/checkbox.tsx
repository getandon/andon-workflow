import * as RadixCheckbox from '@radix-ui/react-checkbox';
import { cn } from '~/lib/utils';
import { Check } from 'lucide-react';

function Checkbox({ className, ...props }: RadixCheckbox.CheckboxProps) {
  return (
    <RadixCheckbox.Root
      className={cn(
        'peer h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
        className,
      )}
      {...props}
    >
      <RadixCheckbox.Indicator className="flex items-center justify-center text-current">
        <Check className="h-3 w-3" />
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
}

export { Checkbox };
