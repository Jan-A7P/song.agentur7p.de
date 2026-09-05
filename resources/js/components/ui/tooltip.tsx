import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
    React.ElementRef<typeof TooltipPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
    <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
            ref={ref}
            sideOffset={sideOffset}
            className={cn(
                'z-[100] max-w-xs rounded-md border border-line bg-ink px-2.5 py-1.5 text-xs leading-snug text-paper shadow-md',
                className,
            )}
            {...props}
        />
    </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

type AppTooltipProps = {
    label: React.ReactNode;
    children: React.ReactElement<{ disabled?: boolean; className?: string }>;
    side?: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>['side'];
    delayDuration?: number;
};

/** Convenience wrapper: wrap any control to show a shadcn tooltip. */
export function AppTooltip({ label, children, side = 'top', delayDuration }: AppTooltipProps) {
    if (label == null || label === false || label === '') {
        return children;
    }

    const trigger = children.props.disabled ? (
        <span className={cn('inline-flex', children.props.disabled && 'cursor-not-allowed')}>{children}</span>
    ) : (
        children
    );

    return (
        <Tooltip delayDuration={delayDuration}>
            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
            <TooltipContent side={side}>{label}</TooltipContent>
        </Tooltip>
    );
}
