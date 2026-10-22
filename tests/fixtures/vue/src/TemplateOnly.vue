<template>
  <footer>
    <UserCard :title="year" />
    <span>{{ formatDate(now) }}</span>
  </footer>
</template>
