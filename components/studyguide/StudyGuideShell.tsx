import { db, get, ref as dbRef, update } from "@/lib/backend";
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { readCachedJson, writeCachedJson } from "../../utils/cache";
import { createAvelutAI, getResponseText, Type } from "../../utils/inference";
import type { UserProfile, Course, Topic, UserProgress } from "../../types";
import { useApiLimiter } from "../../hooks/useApiLimiter";
import { useAppSettings } from "../../hooks/useAppSettings";
import { useToast } from "../../hooks/useToast";
import { LimitExceededModal } from "../LimitExceededModal";
import { checkAICredits, deductAICredits, getFeatureCost, getFeatureModel, hasLiveTutorialAccess } from "../../utils/usage";
import { useSharedTextbookUpload, getCourseMergeKey } from "../../hooks/useSharedTextbookUpload";
import VoiceTutorialPage, { VoiceTutorialSessionData } from "../VoiceTutorialPage";
import CourseChatTutor from "../CourseChatTutor";
import MyNotebooks from "../MyNotebooks";
import { supabaseDataService } from "../../services/supabaseDataService";
import { normalizeLevelValue, normalizeDepartmentValue, normalizeTopicId, sanitizeTopicMetadata, normalizeCourse, formatDuration, formatLastVisited } from "../studyguide/studyGuideUtils";

export const StudyGuide: React.FC<StudyGuideProps> = (props) => (
        <ErrorBoundary>
            <StudyGuideContent {...props} />
        </ErrorBoundary>
    );
