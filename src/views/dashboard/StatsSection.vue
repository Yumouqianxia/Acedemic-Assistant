<script setup lang="ts">
defineProps<{
  gpaDisplay: string | null
  completedCreditsNum: number | null
  currentSemesterInfo: { label: string; credits: number } | null
}>()
</script>

<template>
  <div class="stat-section">
    <div class="stat-card stat-card--gpa">
      <div class="stat-label">GPA</div>
      <div class="stat-value-row">
        <span class="stat-big">{{ gpaDisplay ?? '-' }}</span>
      </div>
    </div>

    <div class="stat-card">
      <div class="stat-label">Completed Credits</div>
      <div class="stat-value-row">
        <span class="stat-big">{{ completedCreditsNum ?? '-' }}</span>
      </div>
      <div class="stat-sub">Accumulated credit points</div>
    </div>

    <div class="stat-card">
      <div class="stat-label">Current Semester Credits</div>
      <div class="stat-value-row">
        <span class="stat-big">{{ currentSemesterInfo?.credits ?? '-' }}</span>
      </div>
      <div class="stat-sub">{{ currentSemesterInfo?.label ?? '-' }}</div>
    </div>
  </div>
</template>

<style scoped>
.stat-section {
  display: flex;
  gap: 16px;
  padding: 22px 28px 6px;
}

.stat-card {
  flex: 1;
  background: var(--bg-surface);
  border-radius: 14px;
  border: 1px solid var(--border);
  padding: 22px 26px 20px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  box-shadow: var(--shadow-s);
}

.stat-card--gpa {
  background: var(--stat-gpa-bg);
  border-color: var(--stat-gpa-border);
}

.stat-label {
  font-size: 11px;
  color: var(--text-m);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.6px;
}

.stat-value-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
}

.stat-big {
  font-size: 36px;
  font-weight: 700;
  color: var(--text-h);
  line-height: 1;
}

.stat-sub {
  font-size: 12px;
  color: var(--text-m);
  margin-top: 1px;
}
</style>
