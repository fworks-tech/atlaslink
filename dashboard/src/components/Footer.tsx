"use client";

import { Anchor, Group, Text } from "@mantine/core";
import { IconBrandGithub } from "@tabler/icons-react";

interface FooterProps {
  className?: string;
}

export default function Footer({ className = "" }: FooterProps) {
  return (
    <footer className={`border-t border-line px-6 py-8 mx-auto w-full max-w-7xl ${className}`}>
      <Group justify="space-between" align="center" gap="lg" className="flex-col sm:flex-row">
        <Group gap="sm" >
          <Text size="sm" c="dimmed">
            atlaslink · Ask Atlas. Together, live. · by{" "}
            <Anchor href="https://flabs.tech" c="dimmed" target="_blank" rel="noopener noreferrer">
              Fabio Ritzel Borges
            </Anchor>
          </Text>
        </Group>
        <Group gap="md" >
          <Anchor
            href="https://github.com/fworks-tech/atlaslink/blob/main/README.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Text size="sm">Docs</Text>
          </Anchor>
          <Anchor
            href="https://github.com/fworks-tech/atlaslink"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", gap: 4 }}
          >
            <IconBrandGithub size={16} />
            <Text size="sm">GitHub</Text>
          </Anchor>
        </Group>
      </Group>
    </footer>
  );
}
