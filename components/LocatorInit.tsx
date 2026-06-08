"use client";

import setupLocatorUI from "@locator/runtime";
import { useEffect } from "react";

export default function LocatorInit() {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      setupLocatorUI();
    }
  }, []);

  return null;
}
