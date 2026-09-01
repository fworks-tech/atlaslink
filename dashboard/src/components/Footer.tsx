"use client";

import { Anchor, Badge, Group, Text } from "@mantine/core";
import { IconBrandGithub } from "@tabler/icons-react";
import HelpTip from "./HelpTip";

interface FooterProps {
  className?: string;
  version: string;
}

export default function Footer({ className = "", version }: FooterProps) {
  return (
    <footer className={`border-t border-zinc-800 px-6 py-8 mx-auto w-full max-w-6xl ${className}`}>
      <Group justify="space-between" gap="sm" className="flex-col sm:flex-row">
        <Group gap="sm" className="text-sm text-zinc-500">
          <Text size="sm" c="dimmed">
            atlaslink · by{" "}
            <Anchor href="https://flabs.tech" c="dimmed" target="_blank" rel="noopener noreferrer">
              Fabio Ritzel Borges
            </Anchor>
          </Text>
          <Badge
            size="sm"
            variant="outline"
            color="dark"
            styles={{ root: { fontFamily: "var(--mantine-font-family-monospace)" } }}
            rightSection={
              <HelpTip text="The currently installed version of Atlaslink. See Releases for history." side="top" />
            }
          >
            {`v${version}`}
          </Badge>
        </Group>
        <Anchor
          href="https://github.com/fworks-tech/atlaslink"
          target="_blank"
          rel="noopener noreferrer"
          c="dimmed"
          className="flex items-center gap-1.5 transition-colors hover:text-zinc-400"
        >
          <IconBrandGithub size={16} />
          <Text size="sm">GitHub</Text>
        </Anchor>
      </Group>
    </footer>
  );
}
